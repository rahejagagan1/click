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
    const FULL_BLEED = ["/dashboard/hr", "/dashboard/scores", "/dashboard/reports"];
    const isFullBleed = FULL_BLEED.some((p) => pathname.startsWith(p));
    const contentCls  = isFullBleed ? "flex-1" : "flex-1 p-6";

    return (
        <div className="flex min-h-screen">
            <Sidebar />
            <main className="flex-1 ml-20 flex flex-col min-h-screen">
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
