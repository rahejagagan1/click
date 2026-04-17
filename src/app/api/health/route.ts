import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
    const start = Date.now();
    try {
        await prisma.$queryRaw`SELECT 1`;
        return NextResponse.json({
            status: "ok",
            db: "connected",
            dbLatencyMs: Date.now() - start,
            timestamp: new Date().toISOString(),
        });
    } catch {
        return NextResponse.json(
            { status: "error", db: "unreachable", timestamp: new Date().toISOString() },
            { status: 503 }
        );
    }
}
