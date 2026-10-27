-- Canonical schema for the Research Publication Portal (direct MySQL / mysql2).
-- Replaces Prisma migrations as the schema record.
--
-- SAFE / IDEMPOTENT: every statement uses CREATE TABLE IF NOT EXISTS. Running
-- this never drops, truncates, recreates, or alters an existing table, so it
-- will not touch existing users, Admin accounts, password hashes, or data.
-- On a database that already has these tables (e.g. created earlier by Prisma),
-- this script is a no-op.

CREATE TABLE IF NOT EXISTS `users` (
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

CREATE TABLE IF NOT EXISTS `verification_tokens` (
  `identifier` VARCHAR(191) NOT NULL,
  `token`      VARCHAR(191) NOT NULL,
  `expires`    DATETIME(3) NOT NULL,
  UNIQUE INDEX `verification_tokens_token_key` (`token`),
  UNIQUE INDEX `verification_tokens_identifier_token_key` (`identifier`, `token`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `sessions` (
  `id`        VARCHAR(191) NOT NULL,
  `tokenHash` VARCHAR(191) NOT NULL,
  `userId`    VARCHAR(191) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `sessions_tokenHash_key` (`tokenHash`),
  INDEX `sessions_userId_idx` (`userId`),
  CONSTRAINT `sessions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
