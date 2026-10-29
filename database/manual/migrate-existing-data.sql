-- ===========================================================================
-- MANUAL, REVIEWED DATA MIGRATION — *** NOT run by `npm run db:migrate` ***
-- (migrate.mjs only reads database/migrations/, never database/manual/.)
--
-- Purpose: move this project's EXISTING rows from the legacy unprefixed tables
-- into the new `research_publication_portal_`-prefixed tables created by
-- migration 002_prefixed_tables.sql.
--
-- RUN ONLY:
--   1. after a full, verified backup of the database,
--   2. after 002_prefixed_tables.sql has created the (empty) prefixed tables,
--   3. after reading every statement below,
--   4. exactly ONCE (re-running would duplicate rows / hit unique keys).
--
-- This script is ADDITIVE. It does not drop, truncate, rename, or alter the
-- legacy tables, and it touches no table owned by another project. The legacy
-- unprefixed tables remain intact as a fallback; drop them later, manually, only
-- after you have verified the prefixed tables and the app against them.
-- ===========================================================================

-- --- Option A (recommended): COPY rows, keep the originals -------------------
-- Copies users first, then verification_tokens, then sessions (whose FK points
-- at the prefixed users table, so users must be populated first).

INSERT INTO `research_publication_portal_users`
  (`id`, `name`, `email`, `passwordHash`, `baseType`, `isAdmin`,
   `schoolCode`, `rollNo`, `emailVerified`, `createdAt`, `updatedAt`)
SELECT
   `id`, `name`, `email`, `passwordHash`, `baseType`, `isAdmin`,
   `schoolCode`, `rollNo`, `emailVerified`, `createdAt`, `updatedAt`
FROM `users`;

INSERT INTO `research_publication_portal_verification_tokens`
  (`identifier`, `token`, `expires`)
SELECT
   `identifier`, `token`, `expires`
FROM `verification_tokens`;

-- Sessions are optional to copy. Copying them keeps everyone signed in; skipping
-- them simply makes users sign in again after the switch (usually harmless).
INSERT INTO `research_publication_portal_sessions`
  (`id`, `tokenHash`, `userId`, `expiresAt`, `createdAt`)
SELECT
   `id`, `tokenHash`, `userId`, `expiresAt`, `createdAt`
FROM `sessions`;

-- --- Option B (alternative): RENAME in place, no duplication -----------------
-- Instead of Option A, you may rename the legacy tables so the data moves in
-- place with its indexes. Do NOT run both A and B. RENAME removes the unprefixed
-- names, so run it only when you are sure no other project needs them and the
-- new code is ready to deploy. (The legacy FK keeps its old unprefixed name;
-- rename the constraint separately if you need it prefixed too.)
--
--   RENAME TABLE
--     `users`               TO `research_publication_portal_users`,
--     `verification_tokens` TO `research_publication_portal_verification_tokens`,
--     `sessions`            TO `research_publication_portal_sessions`;
--
-- (If you take Option B, 002_prefixed_tables.sql becomes a no-op because the
-- tables already exist under the prefixed names.)

-- --- Verify after either option ---------------------------------------------
--   SELECT COUNT(*) FROM `research_publication_portal_users`;
--   SELECT COUNT(*) FROM `research_publication_portal_sessions`;
-- Then run:  npm run db:verify
