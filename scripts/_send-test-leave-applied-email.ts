// Render the email that fires when an EMPLOYEE first applies for leave —
// no approver name yet (request is still pending L1). Sends to
// arpitsharma4602@gmail.com so HR can eyeball the "submitted" format.
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
    // NO approverName / stageLabel / approvalNote — request is fresh,
    // awaiting manager approval.
  });
  console.log("Subject:", content.subject);
  console.log("Sending to: arpitsharma4602@gmail.com");
  await sendEmail({ to: "arpitsharma4602@gmail.com", content });
  console.log("Done.");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
