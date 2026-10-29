/**
 * Canonical table names for the Research Publication Portal.
 *
 * This project shares one MySQL database with other projects, so every table it
 * owns carries the `research_publication_portal_` prefix to avoid name
 * collisions. These constants are the single source of truth: all SQL — the API
 * routes, the session store, and the db:* scripts — builds its identifiers from
 * here, so the prefix is defined in exactly one place and can never drift
 * between files or be mistyped in one query.
 *
 * `.mjs` so it is unambiguously ESM for both consumers: the Node scripts in
 * `scripts/` import it by relative path (`../lib/tables.mjs`) and the Next
 * application imports it via the `@/` alias (`@/lib/tables.mjs`).
 */
export const TABLE_PREFIX = "research_publication_portal_";

export const TABLES = Object.freeze({
  users: `${TABLE_PREFIX}users`,
  sessions: `${TABLE_PREFIX}sessions`,
  verificationTokens: `${TABLE_PREFIX}verification_tokens`,
  schemaMigrations: `${TABLE_PREFIX}schema_migrations`,
});
