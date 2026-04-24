import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

const PUBLIC_PATHS = ["/login", "/api/auth", "/api/health"];

export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // Allow public paths
    if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
        return NextResponse.next();
    }

    // Allow static assets and Next.js internals
    if (
        pathname.startsWith("/_next") ||
        pathname.startsWith("/favicon") ||
        pathname.includes(".")
    ) {
        return NextResponse.next();
    }

    // Check auth token
    const token = await getToken({
        req: request,
        secret: process.env.NEXTAUTH_SECRET,
    });

    if (!token) {
        const loginUrl = new URL("/login", request.url);
        loginUrl.searchParams.set("callbackUrl", pathname);
        return NextResponse.redirect(loginUrl);
    }

    // Admin-only route protection
    const ADMIN_PATHS = ["/admin", "/dashboard/scores/admin", "/dashboard/scores/config"];
    if (ADMIN_PATHS.some((p) => pathname.startsWith(p))) {
        const orgLevel = (token as any).orgLevel;
        const isDeveloper = (token as any).isDeveloper;
        const isAdmin = orgLevel === "ceo" || orgLevel === "special_access" || isDeveloper === true;

        if (!isAdmin) {
            return NextResponse.redirect(new URL("/dashboard", request.url));
        }
    }

    // HR module is now generally available — every authenticated user can hit
    // /dashboard/hr/* and /api/hr/*. Page- and endpoint-level ACLs (e.g.
    // requireAdmin in /api/hr/admin/* and isHRAdmin gates inside admin pages)
    // still keep manager-only views off-limits to regular employees.
    // (Previously this was developer-only behind a rollout flag.)

    // YouTube dashboard: any authenticated user (see youtube-dashboard-access)

    return NextResponse.next();
}

export const config = {
    matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
