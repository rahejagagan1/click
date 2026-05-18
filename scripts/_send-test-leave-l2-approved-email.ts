// Render the email that fires when CEO/HR FINALISES (L2) a leave that
// the manager already approved at L1. Approver name + stage reflect
// the L2 actor; the note is theirs.
import { sendEmail } from "@/lib/email/sender";
import { leaveRequestEmail } from "@/lib/email/templates";

async function main() {
  const content = leaveRequestEmail({
    applicantName: "Arpit Sharma",
    leaveType:     "Sick Leave",
    fromDate:      new Date("2026-05-20T00:00:00.000Z"),
    toDate:        new Date("2026-05-22T00:00:00.000Z"),
    totalDays:     3,
    reason:        "Doctor advised 3 days of complete rest after a viral fever; will rejoin on Monday.",
    // L1 manager (stage 1) — surfaced on the final-approval email too.
    l1ApproverName: "Nikit Raheja",
    l1ApprovalNote: "Take care, get well soon. Forwarding to HR for finalisation.",
    // L2 finaliser (stage 2 — what triggered this email).
    approverName:  "Tanvi Dogra",
    stageLabel:    "Final approval by",
    approvalNote:  "Approved. Balance updated and attendance marked on_leave.",
  });
  console.log("Subject:", content.subject);
  console.log("Sending to: arpitsharma4602@gmail.com");
  await sendEmail({ to: "arpitsharma4602@gmail.com", content });
  console.log("Done.");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
