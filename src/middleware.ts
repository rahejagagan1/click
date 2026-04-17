import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { tokenCanAccessYoutubeDashboard } from "@/lib/youtube-dashboard-access";

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
        const isAdmin = orgLevel === "ceo" || isDeveloper === true;

        if (!isAdmin) {
            return NextResponse.redirect(new URL("/dashboard", request.url));
        }
    }

    // YouTube dashboards: production team + execs + developers (read-only DB metrics)
    if (pathname.startsWith("/dashboard/youtube")) {
        if (!tokenCanAccessYoutubeDashboard(token as any)) {
            return NextResponse.redirect(new URL("/dashboard", request.url));
        }
    }

    return NextResponse.next();
}

export const config = {
    matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
