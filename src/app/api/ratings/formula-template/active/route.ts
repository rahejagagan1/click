import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";

export const dynamic = "force-dynamic";

// GET /api/ratings/formula-template/active?roleType=writer
// Returns the active template's manager sections for any logged-in user.
// Used by the manager rating form to render dynamic section descriptions.
export async function GET(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.email) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const roleType = searchParams.get("roleType");
        if (!roleType) {
            return NextResponse.json({ error: "Missing roleType" }, { status: 400 });
        }

        const template = await prisma.formulaTemplate.findFirst({
            where: { roleType, isActive: true },
            orderBy: { version: "desc" },
            select: {
                id: true,
                roleType: true,
                version: true,
                label: true,
                sections: true,
            },
        });

        if (!template) {
            return NextResponse.json(null);
        }

        return NextResponse.json(serializeBigInt(template));
    } catch (error: any) {
        console.error("Active template GET error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
