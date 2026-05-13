/**
 * Dump every User + EmployeeProfile column for Arpit so we can compare
 * what's in the DB against what the Edit Profile form claims to have
 * saved. Updates a `timestamp` indicator if a `lastUpdated`/`updatedAt`
 * column exists — useful to confirm "yes the PUT actually wrote".
 *
 * Run with: npx tsx scripts/_check-arpit-profile.ts
 */
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

function trunc(v: unknown, n = 60): string {
  if (v === null || v === undefined) return "—";
  if (v instanceof Date) return v.toISOString();
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > n ? s.slice(0, n) + "…" : s;
}

async function main() {
  // Find Arpit by name (case-insensitive). If multiple match, list them all.
  const users = await p.user.findMany({
    where: {
      OR: [
        { name:  { contains: "arpit", mode: "insensitive" } },
        { email: { contains: "arpit", mode: "insensitive" } },
      ],
    },
    select: {
      id: true, name: true, email: true, role: true, orgLevel: true,
      isActive: true, managerId: true, teamCapsule: true,
    },
    orderBy: { id: "asc" },
  });

  if (!users.length) {
    console.log("✗ No user matching 'arpit' found.");
    return;
  }

  for (const u of users) {
    console.log(`\n══ User id=${u.id} ${u.name} <${u.email}> ══════════════════════`);
    console.log(`  role=${u.role}   orgLevel=${u.orgLevel}   active=${u.isActive}`);
    console.log(`  managerId=${u.managerId}   teamCapsule=${u.teamCapsule ?? "—"}`);

    // Inline manager (raw — column may not be in typed client yet).
    try {
      const inline = await p.$queryRawUnsafe<Array<{ inlineManagerId: number | null }>>(
        `SELECT "inlineManagerId" FROM "User" WHERE id = $1`, u.id,
      );
      console.log(`  inlineManagerId=${inline[0]?.inlineManagerId ?? "—"}`);
    } catch { /* column missing pre-migrate */ }

    // EmployeeProfile — typed columns
    const ep = await p.employeeProfile.findUnique({ where: { userId: u.id } });
    if (!ep) {
      console.log(`  ⚠ No EmployeeProfile row for this user.`);
      continue;
    }

    console.log(`\n── EmployeeProfile (typed columns) ──`);
    for (const [k, v] of Object.entries(ep)) {
      console.log(`  ${k.padEnd(28)} ${trunc(v, 80)}`);
    }

    // Extended / Keka-parity columns — raw SQL so we see them even if
    // the prisma client wasn't regenerated.
    console.log(`\n── Extended (raw SQL) ──`);
    try {
      const rows = await p.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT "secondaryJobTitle", "legalEntity", "jobLocation",
                "probationPolicy", "internshipEndDate",
                "leavePlan", "holidayList", "weeklyOff",
                "attendanceNumber", "timeTrackingPolicy", "penalizationPolicy",
                "workCountry", "nationality",
                "homePhone", "physicallyHandicapped",
                "addressLine2", "addressPincode", "addressCountry",
                "permanentLine1", "permanentLine2", "permanentCity",
                "permanentState", "permanentPincode", "permanentCountry",
                "motherName", "spouseName", "childrenNames",
                "emergencyRelationship",
                "attendanceCaptureScheme", "costCenter",
                "pfNumber", "uanNumber", "biometricId",
                "updatedAt"
           FROM "EmployeeProfile"
          WHERE "userId" = $1`,
        u.id,
      );
      const row = rows[0] ?? {};
      for (const [k, v] of Object.entries(row)) {
        console.log(`  ${k.padEnd(28)} ${trunc(v, 80)}`);
      }
    } catch (e: any) {
      console.log(`  ⚠ raw extended SELECT failed: ${e?.message ?? e}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => p.$disconnect());
