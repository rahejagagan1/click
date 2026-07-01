// Single-stage approval policy.
//
// NB Media runs a two-stage approval flow for attendance + leave requests:
//   L1 (direct manager)  → partially_approved
//   L2 (HR / CEO / dev)  → approved  (this stage does the real work:
//                          seeds the Attendance row, credits comp-off,
//                          debits leave balance, etc.)
//
// YT Labs collapses this into ONE stage: the first authorised approver —
// the direct manager OR an HR/CEO/dev — finalises the request outright and
// the L2 step is skipped entirely. This helper answers "does the SUBJECT
// employee's brand use the single-stage flow?" so each approval route can
// route to the finaliser on the very first approve.
//
// Applies to: WFH / On-Duty, Regularization, Comp-off, and Leave.

import prisma from "@/lib/prisma";

export async function isSingleStageApprovalEmployee(
  userId: number | null | undefined,
): Promise<boolean> {
  if (!userId) return false;
  const row = await prisma.user.findUnique({
    where:  { id: userId },
    select: { employeeProfile: { select: { businessUnit: true } } },
  });
  return row?.employeeProfile?.businessUnit === "YT Labs";
}
