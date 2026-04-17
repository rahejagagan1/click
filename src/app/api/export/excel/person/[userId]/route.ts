import { serverError } from "@/lib/api-auth";
import { NextResponse } from "next/server";
import { generatePersonExcel } from "@/lib/excel/generator";

export async function GET(
    request: Request,
    { params }: { params: { userId: string } }
) {
    try {
        const userId = parseInt(params.userId);
        if (isNaN(userId)) {
            return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
        }

        const buffer = await generatePersonExcel(userId);

        return new NextResponse(new Uint8Array(buffer), {
            headers: {
                "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "Content-Disposition": `attachment; filename="person-${userId}-report.xlsx"`,
            },
        });
    } catch (error) {
        return serverError(error, "route");
    }
}
