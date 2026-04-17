import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, requireAdmin, serverError } from "@/lib/api-auth";

export async function GET() {
  const { errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const types = await prisma.leaveType.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
    return NextResponse.json(types);
  } catch (e) { return serverError(e, "GET /api/hr/leaves/types"); }
}

export async function POST(req: NextRequest) {
  const { errorResponse } = await requireAdmin();
  if (errorResponse) return errorResponse;
  try {
    const body = await req.json();
    const lt = await prisma.leaveType.create({ data: body });
    return NextResponse.json(lt);
  } catch (e) { return serverError(e, "POST /api/hr/leaves/types"); }
}
