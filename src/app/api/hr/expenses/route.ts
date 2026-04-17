import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const user = session!.user as any;
  const myId = await resolveUserId(session);

  const { searchParams } = new URL(request.url);
  const view = searchParams.get("view") || "my";
  const isAdmin = user.orgLevel === "ceo" || user.isDeveloper || user.orgLevel === "hr_manager";

  try {
    const where: any =
      view === "my"   ? { userId: user.dbId } :
      isAdmin         ? {} :
      view === "team" ? { user: { managerId: myId } } :
                        { userId: user.dbId };

    const expenses = await prisma.expense.findMany({
      where,
      include: { user: { select: { id: true, name: true, profilePictureUrl: true } }, approvedBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(expenses);
  } catch (error) {
    return serverError(error, "hr/expenses GET");
  }
}

export async function POST(request: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const user = session!.user as any;

  try {
    const body = await request.json();
    const { title, category, amount, expenseDate, description, receiptUrl } = body;

    if (!title || !category || !amount || !expenseDate) {
      return NextResponse.json({ error: "title, category, amount, expenseDate required" }, { status: 400 });
    }

    const expense = await prisma.expense.create({
      data: {
        userId: user.dbId,
        title,
        category,
        amount: parseFloat(amount),
        expenseDate: new Date(expenseDate),
        description,
        receiptUrl,
      },
      include: { user: { select: { id: true, name: true } } },
    });

    return NextResponse.json(expense, { status: 201 });
  } catch (error) {
    return serverError(error, "hr/expenses POST");
  }
}
