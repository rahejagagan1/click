// Render the email that fires when an EMPLOYEE submits a WFH request.
import { sendEmail } from "@/lib/email/sender";
import { wfhRequestEmail } from "@/lib/email/templates";
async function main() {
  const content = wfhRequestEmail({
    applicantName: "Brahampreet Singh",
    date:          new Date("2026-05-18T00:00:00.000Z"),
    reason:        "Police verification visit for passport — needs to stay home for the slot.",
  });
  console.log("Subject:", content.subject);
  await sendEmail({ to: "arpitsharma4602@gmail.com", content });
  console.log("Done.");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
