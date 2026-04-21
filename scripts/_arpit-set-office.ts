import { PrismaClient } from "@prisma/client";
import { istTodayDateOnly } from "../src/lib/ist-date";
import { parseAttLoc, stringifyAttLoc } from "../src/lib/attendance-location";
const p = new PrismaClient();
async function main() {
  const today = istTodayDateOnly();
  const user  = await p.user.findUnique({ where: { email: "arpit@nbmediaproductions.com" }, select: { id: true, name: true } });
  if (!user) { console.log("user not found"); return; }
  const rec = await p.attendance.findUnique({
    where: { userId_date: { userId: user.id, date: today } },
  });
  if (!rec) { console.log(`no attendance row for ${user.name} today (${today.toISOString().slice(0,10)})`); return; }
  const parsed = parseAttLoc(rec.location);
  const next   = stringifyAttLoc({ mode: "office", lat: parsed.lat, lng: parsed.lng, address: parsed.address });
  await p.attendance.update({ where: { id: rec.id }, data: { location: next } });
  console.log(`\u2713 Updated attendance id=${rec.id} for ${user.name}: mode \u2192 office.`);
}
main().catch(console.error).finally(() => p.$disconnect());
