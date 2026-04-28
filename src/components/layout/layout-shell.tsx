"use client";

import { Suspense } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "./sidebar";
import Header from "./header";

export default function LayoutShell({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const isLoginPage = pathname === "/login";

    if (isLoginPage) {
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
    const contentCls  = isFullBleed ? "flex-1" : "flex-1 p-6 lg:p-7";

    return (
        <div className="flex min-h-screen bg-[#f4f7fb]">
            {/* Suspense boundary — Sidebar uses useSearchParams() for the
                nested My-Pay flyout active state. Without this wrapper, any
                statically-prerendered page (/cases, /_not-found, etc.) bails
                during build with the missing-suspense CSR error. */}
            <Suspense fallback={null}>
                <Sidebar />
            </Suspense>
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
