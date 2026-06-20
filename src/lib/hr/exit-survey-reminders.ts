// Emails leaving employees their Exit Survey link ~2 days before their
// last working day (once per exit, stamped via surveyReminderSentAt).
// Skips anyone who already submitted. Gated by the exit_survey_reminders
// email toggle.
import { sendEmail } from "@/lib/email/sender";
import { exitSurveyReminderEmail } from "@/lib/email/templates";
import { isDryRun } from "@/lib/email/transport";
import { isEmailEnabled } from "@/lib/email/toggles";
import { listExitsNeedingReminder, markReminderSent } from "@/lib/hr/exit-survey";

export async function sendExitSurveyReminders(): Promise<number> {
  if (!(await isEmailEnabled("exit_survey_reminders"))) {
    console.log("[exit-survey-reminders] skipped — disabled in admin toggles");
    return 0;
  }
  const targets = await listExitsNeedingReminder();
  if (targets.length === 0) return 0;

  let processed = 0;
  for (const t of targets) {
    if (!t.email) continue;
    const daysRemaining = Math.max(
      0,
      Math.ceil((new Date(`${t.lastWorkingDay}T00:00:00Z`).getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
    );
    try {
      await sendEmail({
        to: t.email,
        content: exitSurveyReminderEmail({ employeeName: t.name, lastWorkingDay: t.lastWorkingDay, daysRemaining }),
      });
      if (!isDryRun()) await markReminderSent(t.exitId);
      processed++;
    } catch (e) {
      console.warn(`[exit-survey-reminders] mail failed: ${t.email}`, e);
    }
  }
  return processed;
}
