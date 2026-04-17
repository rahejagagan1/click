import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

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
 * Always ensures session.user.dbId is populated via DB fallback lookup.
 * Usage:
 *   const { session, errorResponse } = await requireAuth();
 *   if (errorResponse) return errorResponse;
 *   // session is guaranteed to exist here, with dbId set
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
    // Ensure dbId is always populated — JWT may not carry it if session callback threw
    const user = session.user as any;
    if (!user.dbId) {
        try {
            const dbUser = await prisma.user.findUnique({
                where: { email: session.user.email },
                select: { id: true, role: true, orgLevel: true },
            });
            if (dbUser) {
                user.dbId = dbUser.id;
                if (!user.role) user.role = dbUser.role;
                if (!user.orgLevel) user.orgLevel = dbUser.orgLevel;
            }
        } catch {
            // DB lookup failed — proceed without dbId; individual routes will handle missing userId
        }
    }
    return { session, errorResponse: null };
}

/**
 * Checks auth and requires HR admin access (CEO, developer, or HR manager).
 * Use this for all Keka HR module admin routes.
 */
export async function requireHRAdmin() {
    const { session, errorResponse } = await requireAuth();
    if (errorResponse) return { session: null, errorResponse };

    const user = session!.user as any;
    const isHRAdmin =
        user.orgLevel === "ceo" ||
        user.orgLevel === "hr_manager" ||
        user.isDeveloper === true;

    if (!isHRAdmin) {
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

/**
 * Resolves the numeric DB user ID from the session.
 * Falls back to a DB lookup by email if `dbId` is not present.
 */
export async function resolveUserId(session: any): Promise<number | null> {
    const user = session?.user as any;
    if (user?.dbId) return user.dbId;
    if (user?.email) {
        try {
            const found = await prisma.user.findUnique({ where: { email: user.email }, select: { id: true } });
            return found?.id ?? null;
        } catch {
            return null;
        }
    }
    return null;
}

