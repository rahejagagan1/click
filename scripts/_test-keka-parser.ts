// One-shot manual test: parses a Keka CSV via parseKekaFile and prints
// what each row maps to. Run with `npx tsx scripts/_test-keka-parser.ts`.
//
// Pass --file=path/to/file.csv to override the default sample.
//
// Throwaway script — kept around for sanity-checking the importer
// after parser tweaks.

import * as fs from "node:fs";
import { parseKekaFile, mapRowToFormPatch } from "@/lib/keka-import";

async function main() {
  const argFile = process.argv.find((a) => a.startsWith("--file="))?.slice(7);
  const path    = argFile ?? "scripts/__sample-keka.csv";
  if (!fs.existsSync(path)) { console.error("Missing file:", path); process.exit(1); }
  const buf = fs.readFileSync(path);
  // The xlsx lib accepts ArrayBuffer-like; wrap the Node Buffer.
  const ab  = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  // parseKekaFile expects a `File` — but at runtime it only reads
  // `arrayBuffer()`. Stub one out.
  const stubFile = {
    name:        path,
    arrayBuffer: async () => ab,
  } as unknown as File;
  const rows = await parseKekaFile(stubFile);
  console.log(`Parsed ${rows.length} rows.\n`);
  for (const r of rows) {
    const patch = mapRowToFormPatch(r, []);
    console.log(`${r.employeeNumber} ${r.displayName.padEnd(28)}  joining(raw)='${r.joiningDate}' → patch.joiningDate='${patch.joiningDate}'  dob(raw)='${r.dateOfBirth}' → '${patch.dateOfBirth}'  dept='${patch.department}'  worker='${patch.workerType}'`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
