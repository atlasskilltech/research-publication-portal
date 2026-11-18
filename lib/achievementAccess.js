// Who may use achievements, and the admin list/export filters (shared by
// /api/achievements and /api/achievements/export).
import {
  ACHIEVEMENT_TYPES, ACHIEVEMENT_SCHOOLS, ACHIEVEMENT_STATUSES, academicYearRange,
} from "@/lib/achievementTypes";

/** External AUTHOR accounts (AIDC 2027) don't use achievements. */
export function canUseAchievements(me) {
  return !!me && me.baseType !== "AUTHOR";
}

export function adminFilters(sp) {
  const filters = {};
  const type = sp.get("type");
  const school = sp.get("school");
  const status = sp.get("status");
  if (type && ACHIEVEMENT_TYPES[type]) filters.type = type;
  if (school && ACHIEVEMENT_SCHOOLS.includes(school)) filters.school = school;
  if (status && ACHIEVEMENT_STATUSES.includes(status)) filters.status = status;
  const range = academicYearRange(sp.get("year"));
  if (range) Object.assign(filters, range);
  if (sp.get("proof") === "link") filters.needsProof = true;
  if (sp.get("source") === "import") filters.imported = true;
  return { filters, range };
}

