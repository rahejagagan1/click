"use client";
import { useSession } from "next-auth/react";
import { can } from "@/lib/permissions/can";
import AssetsPanel from "@/components/hr/AssetsPanel";

export default function AssetsPage() {
  const { data: session, status } = useSession();
  if (status === "loading") {
    return <div className="min-h-screen bg-[#f4f7f8] dark:bg-[#011627] p-8 text-slate-500">Loading…</div>;
  }
  // Standalone Asset register — gated by MANAGE_ASSETS so a designation that
  // holds only that permission (e.g. IT Security) can use it directly.
  if (!can(session?.user as never, "MANAGE_ASSETS")) {
    return (
      <div className="min-h-screen bg-[#f4f7f8] dark:bg-[#011627] p-8">
        <h1 className="text-xl font-semibold text-slate-800 dark:text-white">Assets</h1>
        <p className="mt-2 text-slate-500">You don&apos;t have access to the asset register.</p>
      </div>
    );
  }
  return (
    <div className="min-h-screen bg-[#f4f7f8] dark:bg-[#011627]">
      <AssetsPanel showHeader />
    </div>
  );
}
