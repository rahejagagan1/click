// Canonical roster of department names HR can pick from anywhere in
// the app (onboarding wizard, employee profile edits, KPI manager).
// This list reflects the actual NB Media org chart — every value here
// matches at least one employee's stored department, and every stored
// department appears here. Curated from the live DB on 2026-05-16
// after HR pruned the earlier role-style list ("Writers", "Editors",
// "Managers", etc.) — those were job TITLES, not departments. Extend
// by appending; alphabetised inside the dropdown is handled by the
// consumer if needed.
export const DEPARTMENTS = [
  "AI Team",
  "Content Strategy & Research",
  "Executive Leadership Team",
  "HR",
  "IT",
  "Operations",
  "Production",
  "Social Media",
];
