import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { serializeBigInt } from "@/lib/utils";
import { encryptPII } from "@/lib/pii-crypto";
import { istTodayDateOnly } from "@/lib/ist-date";

// Editing other employees' profiles is reserved for HR ops + admins.
// Mirrors src/lib/access.ts:isHRAdmin so the server gate matches the UI:
// CEO / developer / special_access / role=admin / hr_manager.
function canEditOthers(session: any): boolean {
  const u = session?.user;
  if (!u) return false;
  return (
    u.orgLevel === "ceo" ||
    u.orgLevel === "hr_manager" ||
    u.orgLevel === "special_access" ||
    u.role === "admin" ||
    u.isDeveloper === true
  );
}

// GET /api/hr/people/:id
// Returns the shape expected by /dashboard/hr/people/[id]/page.tsx:
//   { id, name, email, role, orgLevel, profilePictureUrl, profile, documents, assets, directReports, manager, shift, leaveBalances }
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  try {
    const { id: idParam } = await params;
    const id = parseInt(idParam);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        employeeProfile: true,
        manager: { select: { id: true, name: true, profilePictureUrl: true, role: true } },
        teamMembers: { select: { id: true, name: true, profilePictureUrl: true, role: true } },
        userShift: { include: { shift: true } },
        leaveBalances: { include: { leaveType: true } },
        leavePolicy: { select: { id: true, name: true, isActive: true } },
        heldAssets: { where: { returnedAt: null }, include: { asset: true } },
        ownedDocuments: true,
      },
    });
    if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Inline manager — fetched via raw SQL so the route works even when
    // `prisma generate` hasn't picked up the new column yet (same
    // pattern we use for businessUnit / lastReminderAt).
    let inlineManager: { id: number; name: string; profilePictureUrl: string | null; role: string } | null = null;
    try {
      const rows = await prisma.$queryRawUnsafe<Array<{ id: number; name: string; profilePictureUrl: string | null; role: string }>>(
        `SELECT m.id, m.name, m."profilePictureUrl", m.role::text AS role
           FROM "User" u
           LEFT JOIN "User" m ON m.id = u."inlineManagerId"
          WHERE u.id = $1 AND m.id IS NOT NULL`,
        id,
      );
      inlineManager = rows[0] ?? null;
    } catch (e) {
      console.warn("[people GET] inlineManager lookup failed:", e);
    }

    // Extended onboarding fields — fetched via raw SQL so the GET
    // returns them even when `prisma generate` is stale on the VPS.
    // Merged onto profile below so EditProfilePanel can read them
    // through the same `user.profile.foo` shape it uses for everything.
    let extended: Record<string, unknown> = {};
    try {
      const erows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT "secondaryJobTitle", "legalEntity", "jobLocation",
                "probationPolicy", "internshipEndDate",
                "leavePlan", "holidayList", "weeklyOff",
                "attendanceNumber", "timeTrackingPolicy", "penalizationPolicy",
                "workCountry", "nationality",
                -- Keka-parity additions
                "homePhone", "physicallyHandicapped",
                "addressLine2", "addressPincode", "addressCountry",
                "permanentLine1", "permanentLine2", "permanentCity",
                "permanentState", "permanentPincode", "permanentCountry",
                "motherName", "spouseName", "childrenNames",
                "emergencyRelationship",
                "attendanceCaptureScheme", "costCenter",
                "pfNumber", "uanNumber", "biometricId"
           FROM "EmployeeProfile"
          WHERE "userId" = $1`,
        id,
      );
      extended = erows[0] ?? {};
    } catch (e) {
      console.warn("[people GET] extended fields lookup failed:", e);
    }

    // Today's attendance + any currently-open session — drives the "IN /
    // OUT / OFFLINE" presence badge in the page header. Re-sum the
    // session secs so an open session counts as "IN" even if the parent
    // Attendance.totalMinutes is stale from a prior clock-out.
    const today = istTodayDateOnly();
    const todayAtt = await prisma.attendance.findUnique({
      where: { userId_date: { userId: id, date: today } },
      select: { status: true, clockIn: true, clockOut: true, totalMinutes: true },
    });
    let hasOpenSession = false;
    if (todayAtt) {
      const open = await prisma.$queryRawUnsafe<Array<{ id: number }>>(
        `SELECT s.id FROM "AttendanceSession" s
           JOIN "Attendance" a ON a.id = s."attendanceId"
          WHERE a."userId" = $1 AND a."date" = $2 AND s."clockOut" IS NULL
          LIMIT 1`,
        id, today,
      );
      hasOpenSession = open.length > 0;
    }

    // Reshape to what the detail page reads.
    const { employeeProfile, heldAssets, ownedDocuments, teamMembers, userShift, ...rest } = user;
    const payload = {
      ...rest,
      profile:       employeeProfile ? { ...employeeProfile, ...extended } : null,
      documents:     ownedDocuments,
      assets:        heldAssets.map((a) => ({ ...a.asset, assignedAt: a.assignedAt })),
      directReports: teamMembers,
      shift:         userShift?.shift ?? null,
      inlineManager,
      todayAttendance: todayAtt
        ? { ...todayAtt, hasOpenSession }
        : null,
    };
    return NextResponse.json(serializeBigInt(payload));
  } catch (e) {
    return serverError(e, "GET /api/hr/people/[id]");
  }
}

// PUT /api/hr/people/:id
// Lets HR / CEO / admin / developer edit any employee's User row + EmployeeProfile.
// Mirrors /api/hr/profile PUT (own-edit) but targets the path-param userId.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canEditOthers(session)) {
    return NextResponse.json(
      { error: "Only HR / CEO / admins / developers can edit other employees" },
      { status: 403 },
    );
  }

  try {
    const { id: idParam } = await params;
    const id = parseInt(idParam);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const body = await req.json();
    const {
      displayName,
      employeeId,
      firstName, middleName, lastName,
      phone, workPhone, personalEmail,
      dateOfBirth, gender, bloodGroup, maritalStatus,
      emergencyPhone,
      address, city, state, profilePictureUrl,
      // Sensitive — encrypted at rest before save.
      panNumber, parentName, aadhaarNumber, aadhaarEnrollment,
      // Job + work details (Edit Profile → Job & Work section).
      designation, department, businessUnit, employmentType, workLocation, joiningDate,
      noticePeriodDays,
      // Extended onboarding fields — every wizard input is now editable.
      workCountry, nationality,
      secondaryJobTitle, legalEntity, jobLocation, probationPolicy, internshipEndDate,
      leavePlan, holidayList, weeklyOff, attendanceNumber, timeTrackingPolicy, penalizationPolicy,
      // ── Keka-parity additions (extended profile) ──
      homePhone, physicallyHandicapped,
      addressLine2, addressPincode, addressCountry,
      permanentLine1, permanentLine2, permanentCity, permanentState, permanentPincode, permanentCountry,
      motherName, spouseName, childrenNames,
      emergencyRelationship,
      attendanceCaptureScheme, costCenter,
      pfNumber, uanNumber, biometricId,
      // ABOUT-tab bios — used to be self-edit-only via /api/hr/profile.
      // Now HR-admin can edit them on any user's profile too.
      about, jobLove, hobbies,
      // User row fields — role / orgLevel / manager / team membership.
      role: newRole, orgLevel, managerId, inlineManagerId, teamCapsule,
      // Leave policy assignment — drives accrual + "Apply policy" balances.
      leavePolicyId,
    } = body;

    const target = await prisma.user.findUnique({ where: { id }, select: { id: true, name: true, email: true } });
    if (!target) return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    let existing = await prisma.employeeProfile.findUnique({ where: { userId: id } });
    // Tracks whether we just allocated an HRM on this request — so the
    // "HRM No. cannot be empty" guard below doesn't reject a save that
    // came in with a blank HRM field but already got one assigned here.
    let justAutoCreated = false;

    // Auto-create a minimal EmployeeProfile when the user has none.
    // Users imported via ClickUp sync (and other non-wizard / legacy
    // sources) start without a profile row, so every save below used
    // to silently no-op — the route returned ok but no row existed to
    // UPDATE, which is why HR's edits "disappeared on reload." Mint a
    // profile on first edit using whatever the form sent, falling back
    // to splitting user.name and finally the email local-part.
    if (!existing) {
      const series = await prisma.employeeNumberSeries.findFirst({
        where: { isActive: true },
        orderBy: { id: "asc" },
        select: { id: true },
      });
      if (!series) {
        return NextResponse.json(
          { error: "No active EmployeeNumberSeries — ask HR to create one before editing this profile." },
          { status: 409 },
        );
      }

      // Name fallbacks: form firstName/lastName win; else split user.name;
      // else use email local-part for first and "—" for last.
      const fullName = (target.name ?? "").trim();
      const firstSpace = fullName.indexOf(" ");
      const splitFirst = firstSpace === -1 ? fullName : fullName.slice(0, firstSpace);
      const splitLast  = firstSpace === -1 ? "—"      : fullName.slice(firstSpace + 1);
      const fNameSeed = (typeof firstName === "string" && firstName.trim())
        || splitFirst
        || target.email?.split("@")[0]
        || "Employee";
      const lNameSeed = (typeof lastName === "string" && lastName.trim())
        || splitLast
        || "—";

      try {
        existing = await prisma.$transaction(async (tx) => {
          const bumped = await tx.employeeNumberSeries.update({
            where: { id: series.id },
            data:  { nextNumber: { increment: 1 } },
            select: { id: true, prefix: true, nextNumber: true },
          });
          const claimed = bumped.nextNumber - 1;
          const allocatedEmployeeId =
            (typeof employeeId === "string" && employeeId.trim())
              ? employeeId.trim()
              : `${bumped.prefix}${claimed}`;

          return tx.employeeProfile.create({
            data: {
              userId:         id,
              employeeId:     allocatedEmployeeId,
              firstName:      fNameSeed.trim().slice(0, 60),
              middleName:     typeof middleName === "string" && middleName.trim() ? middleName.trim().slice(0, 60) : null,
              lastName:       lNameSeed.trim().slice(0, 60),
              workCountry:    typeof workCountry === "string" && workCountry.trim() ? workCountry.trim() : "India",
              nationality:    typeof nationality === "string" && nationality.trim() ? nationality.trim() : "Indian",
              numberSeriesId: bumped.id,
            },
          });
        });
        justAutoCreated = true;
      } catch (e: any) {
        console.error("[people PUT] auto-create EmployeeProfile failed:", e);
        if (e?.code === "P2002") {
          return NextResponse.json(
            { error: "Could not allocate a new HRM No. — try again." },
            { status: 409 },
          );
        }
        return NextResponse.json(
          { error: `Could not create profile: ${e?.message ?? "Unknown DB error"}` },
          { status: 500 },
        );
      }
    }

    // Build the EmployeeProfile patch using only the typed columns.
    // Each field is only included when explicitly sent (not undefined) so
    // partial section saves don't overwrite untouched fields with null.
    const profileData: Record<string, unknown> = {};
    // HRM No. — editable. Uniqueness is enforced by Prisma's @unique;
    // we pre-check so we can return a clean 409 instead of a raw P2002.
    let employeeIdNew: string | null = null;
    if (employeeId !== undefined) {
      const trimmed = String(employeeId ?? "").trim();
      if (!trimmed) {
        // If we just allocated an HRM during auto-create, accept the
        // blank submission — the profile already has its assigned number.
        if (justAutoCreated) {
          // fall through; profileData.employeeId stays unset
        } else {
          return NextResponse.json({ error: "HRM No. cannot be empty." }, { status: 400 });
        }
      } else if (existing && trimmed !== existing.employeeId) {
        const clash = await prisma.employeeProfile.findUnique({
          where: { employeeId: trimmed },
          select: { userId: true },
        });
        if (clash && clash.userId !== id) {
          return NextResponse.json(
            { error: `HRM No. "${trimmed}" is already used by another employee.` },
            { status: 409 },
          );
        }
        profileData.employeeId = trimmed;
        employeeIdNew = trimmed;
      }
    }
    // First / Last name are NOT NULL in the schema — only write when the
    // submitted value is non-empty. Middle name is optional and may be null.
    if (firstName  !== undefined) {
      const trimmed = String(firstName ?? "").trim();
      if (trimmed) profileData.firstName = trimmed;
    }
    if (lastName   !== undefined) {
      const trimmed = String(lastName ?? "").trim();
      if (trimmed) profileData.lastName  = trimmed;
    }
    if (middleName !== undefined) {
      const trimmed = String(middleName ?? "").trim();
      profileData.middleName = trimmed || null;
    }
    if (phone             !== undefined) profileData.phone             = phone;
    if (gender            !== undefined) profileData.gender            = gender;
    if (bloodGroup        !== undefined) profileData.bloodGroup        = bloodGroup;
    if (dateOfBirth       !== undefined) profileData.dateOfBirth       = dateOfBirth ? new Date(dateOfBirth) : null;
    if (emergencyPhone    !== undefined) profileData.emergencyPhone    = emergencyPhone;
    if (address           !== undefined) profileData.address           = address;
    if (city              !== undefined) profileData.city              = city;
    if (state             !== undefined) profileData.state             = state;
    if (parentName        !== undefined) profileData.parentName        = parentName;
    if (designation       !== undefined) profileData.designation       = designation || null;
    if (department        !== undefined) profileData.department        = department || null;
    if (employmentType    !== undefined) profileData.employmentType    = employmentType || "fulltime";
    if (workLocation      !== undefined) profileData.workLocation      = workLocation || "office";
    if (joiningDate       !== undefined) profileData.joiningDate       = joiningDate ? new Date(joiningDate) : null;
    if (noticePeriodDays  !== undefined) profileData.noticePeriodDays  = noticePeriodDays === null || noticePeriodDays === ""
                                                                          ? 30
                                                                          : Math.max(0, parseInt(String(noticePeriodDays), 10) || 0);
    if (workCountry       !== undefined) profileData.workCountry       = workCountry || "India";
    if (nationality       !== undefined) profileData.nationality       = nationality || "India";
    if (panNumber         !== undefined) profileData.panNumber         = encryptPII(panNumber);
    if (aadhaarNumber     !== undefined) profileData.aadhaarNumber     = encryptPII(aadhaarNumber);
    if (aadhaarEnrollment !== undefined) profileData.aadhaarEnrollment = encryptPII(aadhaarEnrollment);

    const userPatch: Record<string, unknown> = {};
    if (profilePictureUrl) userPatch.profilePictureUrl = profilePictureUrl;
    if (typeof displayName === "string" && displayName.trim().length > 0) {
      userPatch.name = displayName.trim().slice(0, 120);
    }
    if (newRole   !== undefined) userPatch.role     = newRole;
    if (orgLevel  !== undefined) userPatch.orgLevel = orgLevel;
    if (managerId !== undefined) {
      userPatch.managerId = managerId === null || managerId === "" ? null : parseInt(String(managerId), 10);
    }
    if (teamCapsule !== undefined) userPatch.teamCapsule = teamCapsule || null;
    if (leavePolicyId !== undefined) {
      userPatch.leavePolicyId = leavePolicyId === null || leavePolicyId === ""
        ? null
        : parseInt(String(leavePolicyId), 10);
    }

    const txOps: any[] = [];
    if (Object.keys(userPatch).length > 0) {
      txOps.push(prisma.user.update({ where: { id }, data: userPatch }));
    }
    if (existing && Object.values(profileData).some((v) => v !== undefined)) {
      txOps.push(prisma.employeeProfile.update({
        where: { userId: id },
        data: profileData as any,
      }));
    }
    if (txOps.length > 0) {
      try {
        await prisma.$transaction(txOps);
      } catch (e: any) {
        console.error("[people PUT] main transaction failed:", e);
        if (e?.code === "P2002" && Array.isArray(e?.meta?.target) && e.meta.target.includes("employeeId")) {
          return NextResponse.json(
            { error: `HRM No. is already used by another employee.` },
            { status: 409 },
          );
        }
        return NextResponse.json({
          error: `Save failed: ${e?.message ?? "Unknown DB error"}`,
        }, { status: 500 });
      }
    }

    // Patch the columns the typed client may not know about yet (workPhone /
    // personalEmail / maritalStatus). Same pattern used in /api/hr/profile.
    if (existing) {
      const setParts: string[] = [];
      const args: unknown[] = [];
      let i = 1;
      if (workPhone     !== undefined) { setParts.push(`"workPhone" = $${i++}`);     args.push(workPhone     || null); }
      if (personalEmail !== undefined) { setParts.push(`"personalEmail" = $${i++}`); args.push(personalEmail || null); }
      if (maritalStatus !== undefined) { setParts.push(`"maritalStatus" = $${i++}`); args.push(maritalStatus || null); }
      if (businessUnit  !== undefined) { setParts.push(`"businessUnit" = $${i++}`);  args.push(businessUnit  || "NB Media"); }
      // ── Extended onboarding fields — written via raw SQL so the
      //    route doesn't need a fresh `prisma generate` cycle on the
      //    VPS to start accepting edits to these columns. ──
      if (secondaryJobTitle  !== undefined) { setParts.push(`"secondaryJobTitle" = $${i++}`);  args.push(secondaryJobTitle  || null); }
      if (legalEntity        !== undefined) { setParts.push(`"legalEntity" = $${i++}`);        args.push(legalEntity        || null); }
      if (jobLocation        !== undefined) { setParts.push(`"jobLocation" = $${i++}`);        args.push(jobLocation        || null); }
      if (probationPolicy    !== undefined) { setParts.push(`"probationPolicy" = $${i++}`);    args.push(probationPolicy    || null); }
      if (internshipEndDate  !== undefined) {
        setParts.push(`"internshipEndDate" = $${i++}`);
        args.push(internshipEndDate ? new Date(internshipEndDate) : null);
      }
      if (leavePlan          !== undefined) { setParts.push(`"leavePlan" = $${i++}`);          args.push(leavePlan          || null); }
      if (holidayList        !== undefined) { setParts.push(`"holidayList" = $${i++}`);        args.push(holidayList        || null); }
      if (weeklyOff          !== undefined) { setParts.push(`"weeklyOff" = $${i++}`);          args.push(weeklyOff          || null); }
      // Convention: Attendance Number == HRM (employeeId). When HR
      // submits the field empty we backfill with employeeId so the
      // two stay in sync without forcing them to retype it.
      if (attendanceNumber   !== undefined) {
        const an = (attendanceNumber && String(attendanceNumber).trim()) || existing?.employeeId || null;
        setParts.push(`"attendanceNumber" = $${i++}`); args.push(an);
      }
      if (timeTrackingPolicy !== undefined) { setParts.push(`"timeTrackingPolicy" = $${i++}`); args.push(timeTrackingPolicy || null); }
      if (penalizationPolicy !== undefined) { setParts.push(`"penalizationPolicy" = $${i++}`); args.push(penalizationPolicy || null); }
      // ── Keka-parity additions ──
      if (homePhone               !== undefined) { setParts.push(`"homePhone" = $${i++}`);               args.push(homePhone               || null); }
      if (physicallyHandicapped   !== undefined) { setParts.push(`"physicallyHandicapped" = $${i++}`);   args.push(physicallyHandicapped   || null); }
      if (addressLine2            !== undefined) { setParts.push(`"addressLine2" = $${i++}`);            args.push(addressLine2            || null); }
      if (addressPincode          !== undefined) { setParts.push(`"addressPincode" = $${i++}`);          args.push(addressPincode          || null); }
      if (addressCountry          !== undefined) { setParts.push(`"addressCountry" = $${i++}`);          args.push(addressCountry          || null); }
      if (permanentLine1          !== undefined) { setParts.push(`"permanentLine1" = $${i++}`);          args.push(permanentLine1          || null); }
      if (permanentLine2          !== undefined) { setParts.push(`"permanentLine2" = $${i++}`);          args.push(permanentLine2          || null); }
      if (permanentCity           !== undefined) { setParts.push(`"permanentCity" = $${i++}`);           args.push(permanentCity           || null); }
      if (permanentState          !== undefined) { setParts.push(`"permanentState" = $${i++}`);          args.push(permanentState          || null); }
      if (permanentPincode        !== undefined) { setParts.push(`"permanentPincode" = $${i++}`);        args.push(permanentPincode        || null); }
      if (permanentCountry        !== undefined) { setParts.push(`"permanentCountry" = $${i++}`);        args.push(permanentCountry        || null); }
      if (motherName              !== undefined) { setParts.push(`"motherName" = $${i++}`);              args.push(motherName              || null); }
      if (spouseName              !== undefined) { setParts.push(`"spouseName" = $${i++}`);              args.push(spouseName              || null); }
      if (childrenNames           !== undefined) { setParts.push(`"childrenNames" = $${i++}`);           args.push(childrenNames           || null); }
      if (emergencyRelationship   !== undefined) { setParts.push(`"emergencyRelationship" = $${i++}`);   args.push(emergencyRelationship   || null); }
      if (attendanceCaptureScheme !== undefined) { setParts.push(`"attendanceCaptureScheme" = $${i++}`); args.push(attendanceCaptureScheme || null); }
      if (costCenter              !== undefined) { setParts.push(`"costCenter" = $${i++}`);              args.push(costCenter              || null); }
      if (pfNumber                !== undefined) { setParts.push(`"pfNumber" = $${i++}`);                args.push(pfNumber                || null); }
      if (uanNumber               !== undefined) { setParts.push(`"uanNumber" = $${i++}`);               args.push(uanNumber               || null); }
      if (biometricId             !== undefined) { setParts.push(`"biometricId" = $${i++}`);             args.push(biometricId             || null); }
      // ABOUT-tab bios. Empty string clears (stored NULL) to match the
      // /api/hr/profile self-edit behaviour.
      if (about   !== undefined) { setParts.push(`"about" = $${i++}`);   args.push(typeof about   === "string" && about.trim().length   > 0 ? about   : null); }
      if (jobLove !== undefined) { setParts.push(`"jobLove" = $${i++}`); args.push(typeof jobLove === "string" && jobLove.trim().length > 0 ? jobLove : null); }
      if (hobbies !== undefined) { setParts.push(`"hobbies" = $${i++}`); args.push(typeof hobbies === "string" && hobbies.trim().length > 0 ? hobbies : null); }
      if (setParts.length > 0) {
        args.push(id);
        try {
          await prisma.$executeRawUnsafe(
            `UPDATE "EmployeeProfile" SET ${setParts.join(", ")} WHERE "userId" = $${i}`,
            ...args,
          );
        } catch (e) {
          console.warn("[people PUT] new-column raw update failed:", e);
        }
      }

      // Convention: Attendance No. == HRM No. When HR changes employeeId,
      // mirror the new value into attendanceNumber so the two stay in sync
      // (unless HR explicitly overrode attendanceNumber in the same save).
      if (employeeIdNew && attendanceNumber === undefined) {
        try {
          await prisma.$executeRawUnsafe(
            `UPDATE "EmployeeProfile" SET "attendanceNumber" = $1 WHERE "userId" = $2`,
            employeeIdNew, id,
          );
        } catch (e) {
          console.warn("[people PUT] attendanceNumber sync failed:", e);
        }
      }
    }

    // inlineManagerId lives on User, not EmployeeProfile, and the typed
    // client may not know about it yet. Raw SQL keeps this independent
    // of `prisma generate` cache state on dev/VPS.
    if (inlineManagerId !== undefined) {
      const newInlineId = inlineManagerId === null || inlineManagerId === ""
        ? null
        : parseInt(String(inlineManagerId), 10);
      if (newInlineId !== null && newInlineId === id) {
        return NextResponse.json(
          { error: "Inline manager cannot be the same person." },
          { status: 400 },
        );
      }
      try {
        await prisma.$executeRawUnsafe(
          `UPDATE "User" SET "inlineManagerId" = $1 WHERE id = $2`,
          newInlineId,
          id,
        );
      } catch (e) {
        console.warn("[people PUT] inlineManagerId update failed:", e);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[people PUT] outer catch:", e);
    return NextResponse.json({
      error: `Save failed: ${e?.message ?? "Unknown error"}`,
    }, { status: 500 });
  }
}
