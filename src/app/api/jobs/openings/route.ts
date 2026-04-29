// Public endpoint — no auth. Returns the list of currently-open job
// titles so the public application form can populate its dropdown.
//
// Raw SQL because the typed Prisma client may not know about the new
// JobOpening table until `prisma generate` reruns.
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await prisma.$queryRawUnsafe<
      Array<{ id: number; title: string; department: string | null; location: string | null }>
    >(
      `SELECT id, title, department, location
         FROM "JobOpening"
        WHERE "isOpen" = true
        ORDER BY title ASC`,
    );
    return NextResponse.json(rows);
  } catch (e: any) {
    console.error("[/api/jobs/openings] failed:", e);
    return NextResponse.json({ error: "Could not load openings" }, { status: 500 });
  }
}
