/**
 * Canonical MySQL table names — the ONLY place they are defined.
 *
 * The portal lives in a SHARED database (the cPanel database also used by the
 * Employment Survey), so every table it owns starts with `research_`. Every
 * SQL statement, migration, backup/import script and test builds identifiers
 * from these constants — never from request input — so the prefix cannot drift
 * and the portal can never address another application's tables.
 *
 * Index, unique-key, foreign-key and CHECK names follow the same convention:
 * `research_<table>_<what>_{idx|uq|fk|ck}` (constraint names are database-wide
 * in MySQL, so the prefix also prevents collisions with other applications).
 *
 * `.mjs` so it is ESM for both the Next app (`@/lib/db/tables.mjs`) and the
 * Node scripts (`../lib/db/tables.mjs`).
 */
export const TABLE_PREFIX = "research_";

const t = (name) => `${TABLE_PREFIX}${name}`;

export const T = Object.freeze({
  // Migration history
  schemaMigrations: t("migrations"),
  // Authentication, sessions, tokens
  users: t("users"),
  sessions: t("sessions"),
  userRoles: t("user_roles"),
  authTokens: t("auth_tokens"),
  userIdentities: t("user_identities"),
  oauthStates: t("oauth_states"),
  // External authors (AIDC 2026) — profile + pending (pre-Google) registrations
  authorProfiles: t("author_profiles"),
  authorRegistrations: t("author_registrations"),
  // Workflow
  papers: t("papers"),
  paperAuthors: t("paper_authors"),
  paperManuscripts: t("paper_manuscripts"),
  paperAssignments: t("paper_assignments"), // reviewer + editor assignments per paper
  paperActivity: t("paper_activity"),
  reviews: t("reviews"),
  paperRevisions: t("revisions"),
  editorialDecisions: t("editorial_decisions"),
  // Publication
  volumes: t("volumes"),
  issues: t("issues"),
  publications: t("publications"),
});

/** Every table the portal owns (used by collision checks, backups, tests). */
export const OWN_TABLES = Object.freeze(Object.values(T));
