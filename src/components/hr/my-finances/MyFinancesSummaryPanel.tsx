"use client";

// Inner content of the "My Finances → Summary" page. Lives in its own
// component so HR can render the exact same UI when viewing another
// employee's profile via /dashboard/hr/people/[id] → Finances tab.
//
// Pass `userId` to scope the API call to that employee; admins only
// (the API enforces). Omit the prop to view the logged-in user's data.

import { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { fetcher } from "@/lib/swr";
import { Paperclip, Eye, EyeOff } from "lucide-react";

type Props = { userId?: number };

function maskMiddle(v: string | null | undefined, showLast = 4): string {
  if (!v) return "Not provided";
  const s = String(v);
  if (s.length <= showLast) return s;
  return "X".repeat(s.length - showLast) + s.slice(-showLast);
}

function maskAadhaar(v: string | null | undefined): string {
  if (!v) return "Not provided";
  const s = String(v).replace(/\s|-/g, "");
  if (s.length !== 12) return maskMiddle(s, 4);
  return `XXXX-XXXX-${s.slice(-4)}`;
}

function formatDob(iso: string | null | undefined): string {
  if (!iso) return "Not provided";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Not provided";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

function monthRange(month: number, year: number): string {
  const firstDay = new Date(Date.UTC(year, month, 1));
  const lastDay  = new Date(Date.UTC(year, month + 1, 0));
  const label    = firstDay.toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
  const from     = firstDay.toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" });
  const to       = lastDay.toLocaleDateString("en-IN",  { day: "2-digit", month: "short", timeZone: "UTC" });
  return `${label} (${from} - ${to})`;
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-400">
      {children}
    </p>
  );
}

function Value({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-[13.5px] font-medium text-slate-800">{children}</p>;
}

function VerifiedBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 ring-1 ring-inset ring-emerald-200">
      Verified
    </span>
  );
}

function FileCountChip({ count }: { count: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-sky-600">
      <Paperclip className="h-3.5 w-3.5" />
      {count} file{count === 1 ? "" : "s"}
    </span>
  );
}

export default function MyFinancesSummaryPanel({ userId }: Props) {
  const url = userId ? `/api/hr/payroll/summary?userId=${userId}` : "/api/hr/payroll/summary";
  const payslipsHref = userId ? `/dashboard/hr/people/${userId}?tab=Finances&sub=my-pay` : "/dashboard/hr/payroll";

  const { data, isLoading } = useSWR<{
    profile: any;
    docCount: Record<string, number>;
    latestPayslip: { month: number; year: number; workingDays: number; lopDays: number } | null;
  }>(url, fetcher);

  const profile       = data?.profile ?? null;
  const docCount      = data?.docCount ?? {};
  const latestPayslip = data?.latestPayslip ?? null;

  // Account Number + IFSC are masked by default — eye toggle reveals them.
  // Lives in client state so the toggle is per-session and never persists.
  const [showAccount, setShowAccount] = useState(false);
  const [showIfsc, setShowIfsc] = useState(false);

  const fullName =
    profile?.firstName || profile?.lastName
      ? [profile.firstName, profile.middleName, profile.lastName].filter(Boolean).join(" ")
      : profile?.name || "—";

  const addressLabel = [profile?.address, profile?.city, profile?.state].filter(Boolean).join(", ") || "Not provided";
  const panFiles     = docCount.pan_card ?? 0;
  const aadhaarFiles = docCount.aadhar ?? docCount.aadhaar ?? 0;

  return (
    <div className="space-y-5">
      {/* ── Payroll summary banner ── */}
      <div className="rounded-2xl border border-slate-200 bg-white px-6 py-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
        <div className="grid grid-cols-2 gap-x-8 gap-y-4 md:grid-cols-5">
          <div className="md:col-span-1">
            <h2 className="text-[15px] font-semibold text-slate-800">Payroll summary</h2>
          </div>
          <div>
            <Label>Last processed cycle</Label>
            <Value>{latestPayslip ? monthRange(latestPayslip.month, latestPayslip.year) : "Not run yet"}</Value>
          </div>
          <div>
            <Label>Working days</Label>
            <Value>{latestPayslip?.workingDays ?? "—"}</Value>
          </div>
          <div>
            <Label>Loss of pay</Label>
            <Value>{String(latestPayslip?.lopDays ?? "—")}</Value>
          </div>
          <div>
            <Label>Payslip</Label>
            {latestPayslip ? (
              <Link href={payslipsHref} className="mt-1 block text-[13.5px] font-semibold text-sky-600 hover:underline">
                View payslip
              </Link>
            ) : (
              <Value>—</Value>
            )}
          </div>
        </div>
      </div>

      {/* ── Two-column cards ── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Payment Information */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
          <h3 className="mb-5 text-[15px] font-semibold text-slate-800">Payment Information</h3>

          <div className="mb-5">
            <Label>Salary payment mode</Label>
            <Value>Bank Transfer</Value>
          </div>

          <h4 className="mb-3 text-[13px] font-semibold text-slate-800">Bank Information</h4>
          <div className="grid grid-cols-2 gap-x-8 gap-y-4">
            <div>
              <Label>Bank name</Label>
              <Value>{profile?.bankName || "Not provided"}</Value>
            </div>
            <div>
              <Label>Account number</Label>
              <Value>
                <span className="inline-flex items-center gap-2">
                  <span className="font-mono tracking-wider">
                    {profile?.bankAccountNumber
                      ? (showAccount ? profile.bankAccountNumber : maskMiddle(profile.bankAccountNumber))
                      : "Not provided"}
                  </span>
                  {profile?.bankAccountNumber ? (
                    <button
                      type="button"
                      onClick={() => setShowAccount((v) => !v)}
                      aria-label={showAccount ? "Hide account number" : "Show account number"}
                      title={showAccount ? "Hide" : "Show"}
                      className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    >
                      {showAccount ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  ) : null}
                </span>
              </Value>
            </div>
            <div>
              <Label>IFSC code</Label>
              <Value>
                <span className="inline-flex items-center gap-2">
                  <span className="font-mono tracking-wider">
                    {profile?.bankIfsc
                      ? (showIfsc ? profile.bankIfsc : maskMiddle(profile.bankIfsc, 4))
                      : "Not provided"}
                  </span>
                  {profile?.bankIfsc ? (
                    <button
                      type="button"
                      onClick={() => setShowIfsc((v) => !v)}
                      aria-label={showIfsc ? "Hide IFSC code" : "Show IFSC code"}
                      title={showIfsc ? "Hide" : "Show"}
                      className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    >
                      {showIfsc ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  ) : null}
                </span>
              </Value>
            </div>
            <div>
              <Label>Name on the account</Label>
              <Value>{profile?.accountHolderName || fullName}</Value>
            </div>
            <div className="col-span-2">
              <Label>Branch</Label>
              <Value>{profile?.bankBranch || "N/A"}</Value>
            </div>
          </div>
        </section>

        {/* Identity Information */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
          <h3 className="mb-5 text-[15px] font-semibold text-slate-800">Identity Information</h3>

          {/* PAN Card */}
          <div className="mb-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-5 w-7 items-center justify-center overflow-hidden rounded-[3px] ring-1 ring-slate-200">
                <span className="block h-full w-full bg-gradient-to-b from-[#ff9933] via-white to-[#138808]" />
              </span>
              <span className="text-[14px] font-semibold text-slate-800">Pan Card</span>
              {profile?.panNumber ? <VerifiedBadge /> : null}
            </div>
            <FileCountChip count={panFiles} />
          </div>
          <div className="mb-6 grid grid-cols-2 gap-x-8 gap-y-4">
            <div>
              <Label>Permanent account number</Label>
              <Value>
                <span className="font-mono tracking-wider">
                  {profile?.panNumber ? maskMiddle(profile.panNumber, 4) : "Not provided"}
                </span>
              </Value>
            </div>
            <div>
              <Label>Name</Label>
              <Value>{fullName}</Value>
            </div>
            <div>
              <Label>Date of birth</Label>
              <Value>{formatDob(profile?.dateOfBirth)}</Value>
            </div>
            <div>
              <Label>Parent&apos;s name</Label>
              <Value>{profile?.parentName || "Not provided"}</Value>
            </div>
          </div>

          {/* Photo ID — Aadhaar */}
          <h4 className="mb-3 text-[13px] font-semibold text-slate-800">Photo ID</h4>
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-5 w-7 items-center justify-center overflow-hidden rounded-[3px] ring-1 ring-slate-200">
                <span className="block h-full w-full bg-gradient-to-b from-[#ff9933] via-white to-[#138808]" />
              </span>
              <span className="text-[14px] font-semibold text-slate-800">Aadhaar Card</span>
              {profile?.aadhaarNumber ? <VerifiedBadge /> : null}
            </div>
            <FileCountChip count={aadhaarFiles} />
          </div>
          <div className="mb-6 grid grid-cols-2 gap-x-8 gap-y-4">
            <div>
              <Label>Aadhaar number</Label>
              <Value>
                <span className="font-mono tracking-wider inline-flex items-center gap-2">
                  {maskAadhaar(profile?.aadhaarNumber)}
                  {profile?.aadhaarNumber ? <Eye className="h-3.5 w-3.5 text-slate-400" /> : null}
                </span>
              </Value>
            </div>
            <div>
              <Label>Enrollment number</Label>
              <Value>{profile?.aadhaarEnrollment || "Not Available"}</Value>
            </div>
            <div>
              <Label>Date of birth</Label>
              <Value>{formatDob(profile?.dateOfBirth)}</Value>
            </div>
            <div>
              <Label>Name</Label>
              <Value>{fullName}</Value>
            </div>
            <div>
              <Label>Address</Label>
              <Value>{addressLabel}</Value>
            </div>
            <div>
              <Label>Gender</Label>
              <Value>{profile?.gender ? (profile.gender[0].toUpperCase() + profile.gender.slice(1)) : "Not provided"}</Value>
            </div>
          </div>

          {/* Address Proof — Aadhaar */}
          <h4 className="mb-3 text-[13px] font-semibold text-slate-800">Address Proof</h4>
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-5 w-7 items-center justify-center overflow-hidden rounded-[3px] ring-1 ring-slate-200">
                <span className="block h-full w-full bg-gradient-to-b from-[#ff9933] via-white to-[#138808]" />
              </span>
              <span className="text-[14px] font-semibold text-slate-800">Aadhaar Card</span>
              {profile?.aadhaarNumber ? <VerifiedBadge /> : null}
            </div>
            <FileCountChip count={aadhaarFiles} />
          </div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-4">
            <div>
              <Label>Aadhaar number</Label>
              <Value>
                <span className="font-mono tracking-wider inline-flex items-center gap-2">
                  {maskAadhaar(profile?.aadhaarNumber)}
                  {profile?.aadhaarNumber ? <Eye className="h-3.5 w-3.5 text-slate-400" /> : null}
                </span>
              </Value>
            </div>
            <div>
              <Label>Enrollment number</Label>
              <Value>{profile?.aadhaarEnrollment || "Not Available"}</Value>
            </div>
            <div>
              <Label>Date of birth</Label>
              <Value>{formatDob(profile?.dateOfBirth)}</Value>
            </div>
            <div>
              <Label>Name</Label>
              <Value>{fullName}</Value>
            </div>
            <div>
              <Label>Address</Label>
              <Value>{addressLabel}</Value>
            </div>
            <div>
              <Label>Gender</Label>
              <Value>{profile?.gender ? (profile.gender[0].toUpperCase() + profile.gender.slice(1)) : "Not provided"}</Value>
            </div>
          </div>
        </section>
      </div>

      {isLoading && !data ? (
        <p className="text-center text-[12.5px] text-slate-400">Loading payroll summary…</p>
      ) : null}
    </div>
  );
}
