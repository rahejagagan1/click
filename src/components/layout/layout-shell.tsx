"use client";

import { Suspense, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Sidebar from "./sidebar";
import Header from "./header";

export default function LayoutShell({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const router = useRouter();
    const { data: session } = useSession();
    const isLoginPage = pathname === "/login";
    const isOnboardingPage = pathname === "/onboarding";
    // Public careers / job-application routes — no sidebar / no header.
    // These are meant to be embedded on the marketing site and shouldn't
    // expose any dashboard chrome.
    const isPublicJobsPage = pathname.startsWith("/jobs");

    // First-login wizard gate. If HR set onboardingPending on this user,
    // every navigation outside /login or /onboarding bounces to /onboarding
    // until they finish it.
    useEffect(() => {
        const pending = (session?.user as any)?.onboardingPending === true;
        if (pending && !isOnboardingPage && !isLoginPage && !isPublicJobsPage) {
            router.replace("/onboarding");
        }
    }, [session, pathname, isOnboardingPage, isLoginPage, isPublicJobsPage, router]);

    if (isLoginPage || isPublicJobsPage) {
        return <>{children}</>;
    }

    if (isOnboardingPage) {
        // Onboarding is a full-bleed page — no sidebar / header chrome.
        return <>{children}</>;
    }

    // Routes that already supply their own full-bleed layout / internal
    // padding — leave them edge-to-edge. All other routes get a default
    // 24-px inset so generic content doesn't touch the sidebar border.
    // NOTE: /dashboard/scores is intentionally NOT full-bleed — the audit
    // panel doesn't add its own horizontal padding and was rendering flush
    // against the sidebar, looking unprofessional.
    const FULL_BLEED = ["/dashboard/hr", "/dashboard/reports"];
    const isFullBleed = FULL_BLEED.some((p) => pathname.startsWith(p));
    // Full-bleed routes still get a small left gutter on the content
    // area itself (below the header) so page content doesn't render
    // flush against the sidebar — but the header sits flush, letting
    // the sidebar's NB Media logo visually connect to the welcome banner.
    const contentCls  = isFullBleed ? "flex-1 pl-3 lg:pl-4" : "flex-1 p-6 lg:p-7";

    return (
        <div className="flex min-h-screen bg-[#f4f7fb]">
            {/* Suspense boundary — Sidebar uses useSearchParams() for the
                nested My-Pay flyout active state. Without this wrapper, any
                statically-prerendered page (/cases, /_not-found, etc.) bails
                during build with the missing-suspense CSR error. */}
            <Suspense fallback={null}>
                <Sidebar />
            </Suspense>
            {/* `ml-[92px]` = exact sidebar width — the header butts up
                cleanly against the brand block so they read as one strip. */}
            <main className="ml-[92px] flex min-h-screen flex-1 flex-col bg-[#f4f7fb]">
                <Header />
                <div className={contentCls}>
                    {children}
                </div>
                {!pathname.startsWith("/dashboard") ? (
                    <footer className="border-t border-[#dbe4ed] py-4 text-center">
                        <p className="text-[11px] font-medium tracking-wider text-slate-400">
                            <span className="font-semibold text-slate-500">NB Media</span>
                            <span className="mx-2">•</span>
                            <span>© {new Date().getFullYear()} NB Media Productions</span>
                        </p>
                    </footer>
                ) : null}
            </main>
        </div>
    );
}
