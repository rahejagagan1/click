// Render the email that fires when the MANAGER (L1) approves a leave —
// goes to CEO / HR for finalisation. Shows the L1 manager's name + note.
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
    // Surface the manager's row with a clear "Manager Approved By" label
    // so it stays consistent with the L2 email format.
    l1ApproverName: "Nikit Raheja",
    l1ApprovalNote: "Take care, get well soon. Forwarding to HR for finalisation.",
  });
  console.log("Subject:", content.subject);
  await sendEmail({ to: "arpitsharma4602@gmail.com", content });
  console.log("Done.");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
