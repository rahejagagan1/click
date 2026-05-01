// Canonical HR filter taxonomy. The dropdowns in Employee Directory and
// Organization Tree always list these options, even when no user has a value
// for that dimension yet — so the UI matches Keka. If a user's data happens to
// contain a value outside this list, it's merged in at render time.
import { USER_ROLE_OPTIONS, getUserRoleLabel } from "@/lib/user-role-options";
import { DEPARTMENTS } from "@/lib/departments";

export const UNASSIGNED = "__unassigned__";

export const ENTITY_VALUES = ["NB"] as const;
export const ENTITY_LABEL: Record<string, string> = {
  NB: "NB Media",
};

// Department taxonomy. Single source of truth lives in
// `src/lib/departments.ts` so the values stored by onboarding / Edit
// Profile match the values the People / Org-tree / Approvals filters
// look for. (Previously this was a divergent NB_-prefixed list — filters
// never matched stored values.)
export const DEFAULT_DEPARTMENTS = DEPARTMENTS;

// Default Location options (edit as real data accumulates).
export const DEFAULT_LOCATIONS = ["Mohali"] as const;

// Derive the entity bucket for a user from teamCapsule first, department second.
// Returns "NB" | "YT" | "" (empty means the user has no classifiable data).
export function deriveEntity(u: any): string {
  const tc   = String(u?.teamCapsule ?? "").trim();
  const dept = String(u?.employeeProfile?.department ?? "").trim();
  const src  = (tc || dept).toUpperCase();
  if (src.startsWith("NB")) return "NB";
  return "";
}

export function deriveDepartment(u: any): string {
  return String(u?.employeeProfile?.department ?? "").trim();
}

export function deriveLocation(u: any): string {
  return String(u?.employeeProfile?.workLocation ?? "").trim();
}

export function deriveRole(u: any): string {
  return String(u?.role ?? "").trim();
}

// ── Option builders ─────────────────────────────────────────────────────────
// Each builds the list shown in the dropdown. Structure:
//   [Unassigned?]  [default taxonomy...]  [extra values found in data...]
export type FilterOption = { value: string; label: string };

function mergeOptions(
  defaults: readonly string[],
  discovered: string[],
  labelOf: (v: string) => string = (v) => v,
): FilterOption[] {
  const seen = new Set<string>();
  const out: FilterOption[] = [];
  for (const v of defaults)   { if (!seen.has(v)) { out.push({ value: v, label: labelOf(v) }); seen.add(v); } }
  for (const v of discovered) { if (!seen.has(v)) { out.push({ value: v, label: labelOf(v) }); seen.add(v); } }
  return out;
}

export function entityOptions(users: any[]): FilterOption[] {
  const discovered = new Set<string>();
  users.forEach((u) => { const v = deriveEntity(u); if (v) discovered.add(v); });
  return mergeOptions(ENTITY_VALUES, Array.from(discovered).sort(), (v) => ENTITY_LABEL[v] ?? v);
}

export function departmentOptions(users: any[]): FilterOption[] {
  const discovered = new Set<string>();
  users.forEach((u) => { const v = deriveDepartment(u); if (v) discovered.add(v); });
  return mergeOptions(DEFAULT_DEPARTMENTS, Array.from(discovered).sort());
}

export function locationOptions(users: any[]): FilterOption[] {
  const discovered = new Set<string>();
  users.forEach((u) => { const v = deriveLocation(u); if (v) discovered.add(v); });
  return mergeOptions(DEFAULT_LOCATIONS, Array.from(discovered).sort());
}

export function roleOptions(users: any[]): FilterOption[] {
  const discovered = new Set<string>();
  users.forEach((u) => { const v = deriveRole(u); if (v) discovered.add(v); });
  return mergeOptions(
    USER_ROLE_OPTIONS.map((o) => o.value),
    Array.from(discovered).sort(),
    getUserRoleLabel,
  );
}
