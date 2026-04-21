"use client";

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
    const contentCls  = isFullBleed ? "flex-1" : "flex-1 p-6";

    return (
        <div className="flex min-h-screen">
            <Sidebar />
            {/* ml-20 clears the fixed w-20 sidebar; pl-2 adds a small gutter
                so even full-bleed pages never sit flush against its border. */}
            <main className="flex-1 ml-20 pl-2 flex flex-col min-h-screen">
                <Header />
                <div className={contentCls}>
                    {children}
                </div>
                <footer className="py-4 border-t border-slate-200 text-center">
                    <p className="text-[11px] text-slate-400 font-medium tracking-wider">
                        <span className="font-semibold text-slate-500">NB Media</span>
                        <span className="mx-2">•</span>
                        <span>© {new Date().getFullYear()} NB Media Productions</span>
                    </p>
                </footer>
            </main>
        </div>
    );
}
