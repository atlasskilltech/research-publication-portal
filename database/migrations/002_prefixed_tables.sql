-- 002_prefixed_tables — this project's auth tables under the
-- `research_publication_portal_` prefix, so the Research Publication Portal can
-- share one MySQL database with other projects without table-name collisions.
--
-- SAFE / ADDITIVE / IDEMPOTENT: every statement is CREATE TABLE IF NOT EXISTS.
-- It only ADDS the prefixed tables. It never drops, truncates, renames, alters,
-- or copies any existing table — so the legacy unprefixed tables (users,
-- sessions, verification_tokens) and every table owned by the other projects
-- are left completely untouched.
--
-- These prefixed tables are created EMPTY. Moving existing Research Publication
-- Portal rows from the legacy unprefixed tables into these is a SEPARATE,
-- manual, reviewed step — see database/manual/migrate-existing-data.sql — and is
-- intentionally NOT part of this migration, so nothing is copied automatically.
--
-- Column shapes mirror 001_init.sql exactly. The FOREIGN KEY constraint name is
-- prefixed because InnoDB foreign-key names are unique per DATABASE (an
-- unprefixed one could collide with another project's). Index names are NOT
-- prefixed: they are scoped per-table, so they cannot collide across tables, and
-- prefixing them would exceed MySQL's 64-character identifier limit.

CREATE TABLE IF NOT EXISTS `research_publication_portal_users` (
  `id`            VARCHAR(191) NOT NULL,
  `name`          VARCHAR(191) NOT NULL,
  `email`         VARCHAR(191) NOT NULL,
  `passwordHash`  VARCHAR(255) NOT NULL,
  `baseType`      ENUM('STUDENT','FACULTY') NOT NULL DEFAULT 'STUDENT',
  `isAdmin`       TINYINT(1) NOT NULL DEFAULT 0,
  `schoolCode`    VARCHAR(16) NULL,
  `rollNo`        VARCHAR(64) NULL,
  `emailVerified` DATETIME(3) NULL,
  `createdAt`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`     DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `users_email_key` (`email`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `research_publication_portal_verification_tokens` (
  `identifier` VARCHAR(191) NOT NULL,
  `token`      VARCHAR(191) NOT NULL,
  `expires`    DATETIME(3) NOT NULL,
  UNIQUE INDEX `verification_tokens_token_key` (`token`),
  UNIQUE INDEX `verification_tokens_identifier_token_key` (`identifier`, `token`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `research_publication_portal_sessions` (
  `id`        VARCHAR(191) NOT NULL,
  `tokenHash` VARCHAR(191) NOT NULL,
  `userId`    VARCHAR(191) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `sessions_tokenHash_key` (`tokenHash`),
  INDEX `sessions_userId_idx` (`userId`),
  INDEX `sessions_expiresAt_idx` (`expiresAt`),
  CONSTRAINT `research_publication_portal_sessions_userId_fkey` FOREIGN KEY (`userId`)
    REFERENCES `research_publication_portal_users` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
