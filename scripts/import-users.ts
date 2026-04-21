// Import users from a CSV into the User table (plus EmployeeProfile).
//
// Usage:
//   npx tsx scripts/import-users.ts <path-to-csv>            # dry-run (prints what would happen)
//   npx tsx scripts/import-users.ts <path-to-csv> --apply    # actually inserts / updates
//
// Supported headers (case-insensitive, spaces / underscores / hyphens ignored):
//   name, email, role, orgLevel, managerEmail, teamCapsule,
//   department, designation, employmentType, workLocation,
//   phone, dateOfBirth, gender, bloodGroup, joiningDate,
//   emergencyContact, emergencyPhone, address, city, state,
//   profilePictureUrl, isActive, clickupUserId
//
// managerEmail is resolved in a 2nd pass so a manager listed lower in the CSV
// still gets linked. Unknown columns are ignored. Missing rows (no email) are
// skipped with a warning.

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();

// ── Zero-dep CSV parser (RFC 4180-ish: quoted fields, escaped quotes, commas) ─
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;
  const src = text.replace(/\r\n?/g, "\n");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(cur); cur = ""; }
      else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
      else cur += c;
    }
  }
  if (cur.length > 0 || row.length > 0) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

// Normalize header: lowercase, strip non-alphanumerics.
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const HEADER_ALIASES: Record<string, string> = {
  id: "srcId",              // source row id — used for managerId cross-refs
  name: "name", fullname: "name", employeename: "name",
  email: "email", emailaddress: "email", workemail: "email",
  role: "role",
  orglevel: "orgLevel", level: "orgLevel",
  manageremail: "managerEmail", manager: "managerEmail", reportsto: "managerEmail",
  managerid: "managerSrcId",
  teamcapsule: "teamCapsule", team: "teamCapsule",
  department: "department", dept: "department",
  designation: "designation", jobtitle: "designation", title: "designation",
  employmenttype: "employmentType", type: "employmentType",
  worklocation: "workLocation", location: "workLocation",
  phone: "phone", mobile: "phone", phonenumber: "phone",
  dateofbirth: "dateOfBirth", dob: "dateOfBirth",
  gender: "gender",
  bloodgroup: "bloodGroup",
  joiningdate: "joiningDate", dateofjoining: "joiningDate", doj: "joiningDate",
  emergencycontact: "emergencyContact",
  emergencyphone: "emergencyPhone",
  address: "address",
  city: "city",
  state: "state",
  profilepictureurl: "profilePictureUrl", photo: "profilePictureUrl",
  isactive: "isActive", active: "isActive",
  clickupuserid: "clickupUserId",
  reportaccess: "reportAccess",
  monthlydeliverytargetcases: "monthlyDeliveryTargetCases",
};

// Treat these string values as empty/null.
const isNullish = (s: string | undefined) =>
  !s || s.trim() === "" || s.trim().toUpperCase() === "NULL";

function clickupIdFromEmail(email: string): bigint {
  let n = 0n;
  for (let i = 0; i < email.length; i++) n = (n * 131n + BigInt(email.charCodeAt(i))) % 9_007_199_254_740_991n;
  return n <= 0n ? 1n : n;
}
function parseDate(s: string | undefined): Date | null {
  if (!s) return null;
  const t = new Date(s);
  return isNaN(t.getTime()) ? null : t;
}
function parseBool(s: string | undefined, def = true): boolean {
  if (!s) return def;
  const v = s.trim().toLowerCase();
  return ["true", "yes", "y", "1", "active"].includes(v);
}

async function main() {
  const file = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (!file) {
    console.error("Usage: npx tsx scripts/import-users.ts <path-to-csv> [--apply]");
    process.exit(1);
  }
  const full = path.resolve(file);
  if (!fs.existsSync(full)) {
    console.error(`CSV not found: ${full}`);
    process.exit(1);
  }

  const text = fs.readFileSync(full, "utf8");
  const rows = parseCsv(text);
  if (rows.length < 2) {
    console.error("CSV has no data rows.");
    process.exit(1);
  }
  const rawHeaders = rows[0];
  const headers = rawHeaders.map((h) => HEADER_ALIASES[norm(h)] ?? null);
  const unknown = rawHeaders.filter((_, i) => headers[i] === null);
  if (unknown.length) console.log(`(Ignoring unknown columns: ${unknown.join(", ")})`);

  const records: Record<string, string>[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const rec: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      if (!key) continue;
      const raw = (row[c] ?? "").trim();
      rec[key] = isNullish(raw) ? "" : raw;
    }
    records.push(rec);
  }

  // Validate emails
  const valid = records.filter((r) => {
    const ok = !!r.email && /.+@.+\..+/.test(r.email);
    if (!ok) console.warn(`  ! Skipping row with no/invalid email: ${JSON.stringify(r)}`);
    return ok;
  });
  console.log(`\nParsed ${records.length} rows, ${valid.length} valid (with email).`);
  if (!apply) {
    console.log("\nSample record (first valid):", valid[0]);
    console.log("\nDRY RUN — re-run with --apply to import.");
    return;
  }

  // ── Pass 1: upsert Users (manager left null, resolved in pass 2) ─────────
  // srcId → DB id map, so managerId cross-references from the CSV still resolve
  // even though the DB auto-assigns fresh ids.
  const srcIdToDbId = new Map<string, number>();
  let created = 0, updated = 0;
  for (const rec of valid) {
    const email = rec.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });

    const userData: any = {
      name:              rec.name || email.split("@")[0],
      role:              (rec.role as any) || "member",
      orgLevel:          (rec.orgLevel as any) || "member",
      teamCapsule:       rec.teamCapsule || null,
      isActive:          parseBool(rec.isActive, true),
      profilePictureUrl: rec.profilePictureUrl || null,
      reportAccess:      parseBool(rec.reportAccess, false),
    };
    if (rec.monthlyDeliveryTargetCases && /^\d+$/.test(rec.monthlyDeliveryTargetCases)) {
      userData.monthlyDeliveryTargetCases = parseInt(rec.monthlyDeliveryTargetCases, 10);
    }

    let dbId: number;
    if (existing) {
      await prisma.user.update({ where: { email }, data: userData });
      dbId = existing.id;
      updated++;
    } else {
      const clickupUserId = rec.clickupUserId && /^\d+$/.test(rec.clickupUserId)
        ? BigInt(rec.clickupUserId)
        : clickupIdFromEmail(email);
      try {
        const u = await prisma.user.create({
          data: { email, clickupUserId, ...userData },
          select: { id: true },
        });
        dbId = u.id;
        created++;
      } catch (e: any) {
        if (e?.code === "P2002") {
          const u = await prisma.user.create({
            data: { email, clickupUserId: BigInt(Date.now()) * 1000n + BigInt(created), ...userData },
            select: { id: true },
          });
          dbId = u.id;
          created++;
        } else {
          console.error(`  ✗ Failed to create ${email}:`, e.message);
          continue;
        }
      }
    }
    if (rec.srcId) srcIdToDbId.set(rec.srcId, dbId);
  }
  console.log(`Users: +${created} created, ~${updated} updated.`);

  // ── Pass 2: resolve managerSrcId (CSV id) or managerEmail → managerId ────
  let linked = 0, missingMgr = 0;
  for (const rec of valid) {
    let mgrDbId: number | null = null;
    if (rec.managerSrcId && srcIdToDbId.has(rec.managerSrcId)) {
      mgrDbId = srcIdToDbId.get(rec.managerSrcId)!;
    } else if (rec.managerEmail) {
      const mgr = await prisma.user.findUnique({
        where: { email: rec.managerEmail.toLowerCase() },
        select: { id: true },
      });
      if (mgr) mgrDbId = mgr.id;
    }
    if (mgrDbId === null) {
      if (rec.managerSrcId || rec.managerEmail) {
        missingMgr++;
        console.warn(`  ! Manager not resolved for ${rec.email}: srcId=${rec.managerSrcId} email=${rec.managerEmail}`);
      }
      continue;
    }
    await prisma.user.update({ where: { email: rec.email.toLowerCase() }, data: { managerId: mgrDbId } });
    linked++;
  }
  console.log(`Manager links: ${linked} set, ${missingMgr} missing.`);

  // ── Pass 3: upsert EmployeeProfile for rows that carry profile fields ────
  const profileFields = ["department","designation","employmentType","workLocation","phone","dateOfBirth","gender","bloodGroup","joiningDate","emergencyContact","emergencyPhone","address","city","state"];
  let profiled = 0;
  for (const rec of valid) {
    const hasAny = profileFields.some((f) => rec[f]);
    if (!hasAny) continue;
    const user = await prisma.user.findUnique({ where: { email: rec.email.toLowerCase() }, select: { id: true } });
    if (!user) continue;
    const employeeId = `NB-${new Date().getFullYear()}-${String(user.id).padStart(3, "0")}`;
    const data: Record<string, unknown> = { employeeId };
    for (const f of profileFields) {
      if (rec[f]) {
        data[f] = ["dateOfBirth","joiningDate"].includes(f) ? parseDate(rec[f]) : rec[f];
      }
    }
    await prisma.employeeProfile.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...data },
      update: data,
    });
    profiled++;
  }
  console.log(`EmployeeProfile: ${profiled} upserted.`);

  const final = await prisma.user.count();
  console.log(`\n✓ Done. Total User rows now: ${final}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
