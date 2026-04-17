import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

/**
 * Safely handles API errors — logs the real message server-side,
 * returns a generic message to the client so internals are never exposed.
 */
export function serverError(error: unknown, context: string): NextResponse {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[API Error] ${context}:`, message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

/**
 * Checks auth and returns the session, or a 401 response.
 * Usage:
 *   const { session, errorResponse } = await requireAuth();
 *   if (errorResponse) return errorResponse;
 *   // session is guaranteed to exist here
 */
export async function requireAuth() {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return {
            session: null,
            errorResponse: NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 }
            ),
        };
    }
    return { session, errorResponse: null };
}

/**
 * Checks auth and requires admin access (CEO or developer).
 */
export async function requireAdmin() {
    const { session, errorResponse } = await requireAuth();
    if (errorResponse) return { session: null, errorResponse };

    const user = session!.user as any;
    const isAdmin =
        user.orgLevel === "ceo" ||
        user.orgLevel === "special_access" ||
        user.isDeveloper === true;

    if (!isAdmin) {
        return {
            session: null,
            errorResponse: NextResponse.json(
                { error: "Forbidden" },
                { status: 403 }
            ),
        };
    }

    return { session, errorResponse: null };
}
