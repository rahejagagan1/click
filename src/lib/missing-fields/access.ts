// Server-side gate for the Missing Fields tool — developers only, mirroring
// the sidebar's `developerOnly` nav gate and the page's client guard. Primary
// signal is the session's isDeveloper flag (set by auth.ts from DEVELOPER_EMAILS);
// we also fall back to the env list directly in case the flag didn't propagate.
export function isMissingFieldsDeveloper(user: any): boolean {
  if (!user) return false;
  if (user.isDeveloper === true) return true;
  const allow = (process.env.DEVELOPER_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return !!user.email && allow.includes(String(user.email).toLowerCase());
}
