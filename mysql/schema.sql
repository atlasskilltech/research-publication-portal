-- ============================================================================
-- Research Publication Portal — MySQL schema
-- ============================================================================
-- This is the MySQL translation of the Supabase/PostgreSQL migrations in
-- ../supabase/migrations (0001–0011). It targets MySQL 8.0.16+ or MariaDB
-- 10.4+ (needs CHECK enforcement, JSON, STORED generated columns, expression
-- defaults and composite foreign keys).
--
-- KEY DIFFERENCES FROM THE POSTGRES ORIGINAL — read before deploying:
--
--   * No Row Level Security. Postgres enforced read access with RLS policies
--     and SECURITY DEFINER helper functions (current_user_is_admin, …). MySQL
--     has none of that: the app connects as ONE trusted user and enforces every
--     read/write rule in application code (lib/paperAccess.js, lib/adminGuards.js
--     and the data-access layer). The table comments note which old policy the
--     app now stands in for.
--
--   * No in-database state-machine functions. The PL/pgSQL SECURITY DEFINER
--     functions (request_paper_revision, save/release_editorial_decision,
--     schedule_publication, admin_set_user_roles, set_issue_status, …) are
--     reimplemented as application transactions that SELECT … FOR UPDATE, take a
--     GET_LOCK() advisory lock where needed, re-check the transition, and write.
--
--   * Identity/auth lives here now, not in Supabase Auth. rpp_users replaces
--     auth.users; rpp_sessions and rpp_email_tokens replace Supabase sessions
--     and one-time email links. Passwords are bcrypt hashes in rpp_users.
--
--   * Table names are prefixed rpp_ because this database
--     (atlasuniversitye_employment_survey) is shared with other applications;
--     the prefix guarantees no collision with existing tables.
--
--   * Type mapping: uuid→CHAR(36), text→TEXT/VARCHAR, text[]/jsonb→JSON,
--     boolean→TINYINT(1), timestamptz→DATETIME (UTC), partial unique indexes→
--     STORED generated column + UNIQUE index.
--
-- UUIDs: the application generates v4 UUIDs (crypto.randomUUID()) and passes
-- them on INSERT. DEFAULT (UUID()) is kept only as a safety net for manual SQL.
--
-- This script is idempotent (CREATE TABLE IF NOT EXISTS) and can be re-run.
-- ============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================================
-- AUTH — replaces Supabase Auth (auth.users, sessions, one-time email links)
-- ============================================================================

-- Identities. Replaces auth.users. Email is stored lower-cased (the app
-- normalises before writing); UNIQUE(email) is therefore case-insensitive in
-- practice. password_hash is NULL until the user completes password setup
-- (the invited/unconfirmed state Supabase modelled with an unconfirmed user).
CREATE TABLE IF NOT EXISTS rpp_users (
  id                 CHAR(36)     NOT NULL DEFAULT (UUID()),
  email              VARCHAR(191) NOT NULL,
  email_confirmed_at DATETIME     NULL,
  password_hash      VARCHAR(255) NULL,
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY rpp_users_email_key (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Server-side sessions. The session cookie carries only the opaque, random
-- session id (never a JWT); the row is the source of truth and can be revoked.
-- Replaces Supabase's cookie-based access/refresh tokens.
CREATE TABLE IF NOT EXISTS rpp_sessions (
  id           CHAR(43)     NOT NULL,            -- 32 random bytes, base64url
  user_id      CHAR(36)     NOT NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at   DATETIME     NOT NULL,
  PRIMARY KEY (id),
  KEY rpp_sessions_user_idx (user_id),
  KEY rpp_sessions_expires_idx (expires_at),
  CONSTRAINT rpp_sessions_user_fk FOREIGN KEY (user_id)
    REFERENCES rpp_users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One-time email links (invite = first password setup, recovery = reset/resend).
-- We store only the SHA-256 hash of the token; the raw token lives solely in the
-- emailed link. Replaces Supabase auth.admin.generateLink + verifyOtp. `flow`
-- selects the destination page (setup → create-password, reset → reset-password).
CREATE TABLE IF NOT EXISTS rpp_email_tokens (
  token_hash  CHAR(64)     NOT NULL,             -- sha256 hex of the raw token
  user_id     CHAR(36)     NOT NULL,
  type        VARCHAR(16)  NOT NULL,             -- 'invite' | 'recovery'
  flow        VARCHAR(16)  NOT NULL DEFAULT 'setup', -- 'setup' | 'reset'
  expires_at  DATETIME     NOT NULL,
  consumed_at DATETIME     NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (token_hash),
  KEY rpp_email_tokens_user_idx (user_id),
  KEY rpp_email_tokens_expires_idx (expires_at),
  CONSTRAINT rpp_email_tokens_type_chk CHECK (type IN ('invite','recovery')),
  CONSTRAINT rpp_email_tokens_flow_chk CHECK (flow IN ('setup','reset')),
  CONSTRAINT rpp_email_tokens_user_fk FOREIGN KEY (user_id)
    REFERENCES rpp_users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 0001/0003 PROFILES — per-user application fields + the is_admin flag
-- ============================================================================
-- 1:1 with rpp_users. The handle_new_user() trigger is gone: the registration
-- transaction inserts the users row and this row together, always with
-- is_admin = 0 (privilege can never arrive from the client). Admin elevation is
-- a deliberate, separate action (the role data-access layer / provisioning).
--
-- application_no: one account per application number, case-insensitive, only for
-- rows that carry one (faculty don't). Postgres used a partial unique index on
-- lower(application_no); MySQL uses a STORED generated column + UNIQUE (NULLs
-- are exempt from UNIQUE, so faculty rows never collide).
CREATE TABLE IF NOT EXISTS rpp_profiles (
  id                 CHAR(36)     NOT NULL,
  email              VARCHAR(191) NULL,
  name               VARCHAR(300) NOT NULL DEFAULT '',
  base_type          VARCHAR(16)  NOT NULL DEFAULT 'STUDENT',
  is_admin           TINYINT(1)   NOT NULL DEFAULT 0,
  school_code        VARCHAR(64)  NULL,
  roll_no            VARCHAR(64)  NULL,
  application_no     VARCHAR(128) NULL,
  application_no_lc  VARCHAR(128) AS (LOWER(application_no)) STORED,
  legacy_id          VARCHAR(64)  NULL,          -- old MySQL CUID, traceability only
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY rpp_profiles_application_no_key (application_no_lc),
  KEY rpp_profiles_is_admin_idx (is_admin),
  CONSTRAINT rpp_profiles_base_type_chk CHECK (base_type IN ('STUDENT','FACULTY')),
  CONSTRAINT rpp_profiles_user_fk FOREIGN KEY (id)
    REFERENCES rpp_users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 0004 USER_ROLES — additional roles granted by an administrator
-- ============================================================================
-- base_type (Student/Faculty) stays on the profile. is_admin on the profile is
-- the SOLE source of truth for admin authorization; the 'ADMINISTRATOR' row
-- here mirrors it and the role data-access layer changes BOTH in one
-- transaction under the 'admin_role_change' advisory lock (replacing the
-- Postgres advisory lock + admin_set_user_roles() function). Guards (self /
-- protected original admins / last administrator) are enforced in that layer.
CREATE TABLE IF NOT EXISTS rpp_user_roles (
  user_id     CHAR(36)     NOT NULL,
  role        VARCHAR(32)  NOT NULL,
  assigned_by CHAR(36)     NULL,
  assigned_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, role),
  KEY rpp_user_roles_user_idx (user_id),
  KEY rpp_user_roles_role_idx (role),
  CONSTRAINT rpp_user_roles_role_chk
    CHECK (role IN ('ADMINISTRATOR','SPOC','DESK_REVIEWER','PEER_REVIEWER','EDITOR')),
  CONSTRAINT rpp_user_roles_user_fk FOREIGN KEY (user_id)
    REFERENCES rpp_users (id) ON DELETE CASCADE,
  CONSTRAINT rpp_user_roles_assigned_by_fk FOREIGN KEY (assigned_by)
    REFERENCES rpp_users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 0005 SUBMISSIONS — papers, authors, manuscripts, assignments, activity
-- ============================================================================
-- Reviewer-facing paper row. Author identity is kept in a SEPARATE table so
-- double-blind review can be enforced in code (reviewers read the paper but
-- never rpp_paper_authors). keywords: text[] → JSON array.
CREATE TABLE IF NOT EXISTS rpp_papers (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()),
  title         TEXT         NOT NULL,
  abstract      TEXT         NOT NULL,
  keywords      JSON         NOT NULL,           -- JSON array of strings
  school_code   VARCHAR(64)  NULL,
  status        VARCHAR(16)  NOT NULL DEFAULT 'SUBMITTED',
  current_round INT          NOT NULL DEFAULT 0, -- 0007
  submitted_by  CHAR(36)     NULL,               -- SET NULL: never destroy the record
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY rpp_papers_submitted_by_idx (submitted_by),
  KEY rpp_papers_status_idx (status),
  CONSTRAINT rpp_papers_status_chk CHECK (status IN
    ('SUBMITTED','UNDER_REVIEW','REVISION','ACCEPTED','REJECTED','PUBLISHED','ARCHIVED')),
  CONSTRAINT rpp_papers_submitted_by_fk FOREIGN KEY (submitted_by)
    REFERENCES rpp_users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Author identity — kept separate for double-blind. One corresponding author
-- per paper: Postgres used a partial unique index; MySQL uses a generated
-- column that is paper_id only when is_corresponding, NULL otherwise.
CREATE TABLE IF NOT EXISTS rpp_paper_authors (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()),
  paper_id         CHAR(36)     NOT NULL,
  full_name        VARCHAR(300) NOT NULL,
  email            VARCHAR(191) NULL,
  affiliation      VARCHAR(500) NULL,
  is_corresponding TINYINT(1)   NOT NULL DEFAULT 0,
  author_order     INT          NOT NULL,
  corr_key         CHAR(36)     AS (IF(is_corresponding = 1, paper_id, NULL)) STORED,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY rpp_paper_authors_order_key (paper_id, author_order),
  UNIQUE KEY rpp_paper_authors_one_corresponding (corr_key),
  KEY rpp_paper_authors_paper_idx (paper_id),
  CONSTRAINT rpp_paper_authors_paper_fk FOREIGN KEY (paper_id)
    REFERENCES rpp_papers (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Manuscript file METADATA. Bytes live on the server filesystem
-- (MANUSCRIPT_STORAGE_DIR), never in the DB. version: 0 = original, n = revision
-- round n (0007). One file per (paper, version).
CREATE TABLE IF NOT EXISTS rpp_paper_manuscripts (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()),
  paper_id          CHAR(36)     NOT NULL,
  version           INT          NOT NULL DEFAULT 0,
  storage_key       VARCHAR(191) NOT NULL,       -- server-generated, unpredictable; NOT a path
  original_filename VARCHAR(500) NULL,
  mime_type         VARCHAR(191) NOT NULL,
  byte_size         BIGINT       NOT NULL,
  sha256            CHAR(64)     NOT NULL,
  uploaded_by       CHAR(36)     NULL,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY rpp_paper_manuscripts_storage_key (storage_key),
  UNIQUE KEY rpp_paper_manuscripts_paper_version (paper_id, version),
  KEY rpp_paper_manuscripts_paper_idx (paper_id),
  CONSTRAINT rpp_paper_manuscripts_version_chk CHECK (version >= 0),
  CONSTRAINT rpp_paper_manuscripts_paper_fk FOREIGN KEY (paper_id)
    REFERENCES rpp_papers (id) ON DELETE CASCADE,
  CONSTRAINT rpp_paper_manuscripts_uploaded_by_fk FOREIGN KEY (uploaded_by)
    REFERENCES rpp_users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Per-paper role assignments (SPOC/DESK_REVIEWER/PEER_REVIEWER/EDITOR).
-- due_at (0006) is the optional per-assignment review deadline.
CREATE TABLE IF NOT EXISTS rpp_paper_assignments (
  id          CHAR(36)     NOT NULL DEFAULT (UUID()),
  paper_id    CHAR(36)     NOT NULL,
  assignee    CHAR(36)     NOT NULL,
  role        VARCHAR(32)  NOT NULL,
  due_at      DATETIME     NULL,
  assigned_by CHAR(36)     NULL,
  assigned_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY rpp_paper_assignments_unique (paper_id, assignee, role),
  KEY rpp_paper_assignments_paper_idx (paper_id),
  KEY rpp_paper_assignments_assignee_idx (assignee),
  CONSTRAINT rpp_paper_assignments_role_chk
    CHECK (role IN ('SPOC','DESK_REVIEWER','PEER_REVIEWER','EDITOR')),
  CONSTRAINT rpp_paper_assignments_paper_fk FOREIGN KEY (paper_id)
    REFERENCES rpp_papers (id) ON DELETE CASCADE,
  CONSTRAINT rpp_paper_assignments_assignee_fk FOREIGN KEY (assignee)
    REFERENCES rpp_users (id) ON DELETE CASCADE,
  CONSTRAINT rpp_paper_assignments_assigned_by_fk FOREIGN KEY (assigned_by)
    REFERENCES rpp_users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Audit trail. detail: jsonb → JSON. Author-visible actions are filtered in the
-- app (OWNER_VISIBLE_ACTIONS in lib/reviewLogic.js) — the old RLS allowlist.
CREATE TABLE IF NOT EXISTS rpp_paper_activity (
  id         CHAR(36)     NOT NULL DEFAULT (UUID()),
  paper_id   CHAR(36)     NOT NULL,
  actor      CHAR(36)     NULL,
  action     VARCHAR(64)  NOT NULL,
  detail     JSON         NOT NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY rpp_paper_activity_paper_idx (paper_id, created_at),
  CONSTRAINT rpp_paper_activity_paper_fk FOREIGN KEY (paper_id)
    REFERENCES rpp_papers (id) ON DELETE CASCADE,
  CONSTRAINT rpp_paper_activity_actor_fk FOREIGN KEY (actor)
    REFERENCES rpp_users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 0006/0007 REVIEWS — one per (paper, reviewer, round)
-- ============================================================================
-- A SUBMITTED review must be complete — enforced in the app (submitReview) and
-- by the CHECK below. Authors never read this table (confidential_to_editor);
-- the app grants read only to the reviewer, admins and the paper's editor.
CREATE TABLE IF NOT EXISTS rpp_reviews (
  id                     CHAR(36)     NOT NULL DEFAULT (UUID()),
  paper_id               CHAR(36)     NOT NULL,
  reviewer               CHAR(36)     NOT NULL,
  round                  INT          NOT NULL DEFAULT 0,
  status                 VARCHAR(16)  NOT NULL DEFAULT 'DRAFT',
  recommendation         VARCHAR(16)  NULL,
  technical_quality      INT          NULL,
  originality            INT          NULL,
  methodology            INT          NULL,
  clarity                INT          NULL,
  strengths              TEXT         NULL,
  weaknesses             TEXT         NULL,
  comments_to_author     TEXT         NULL,
  confidential_to_editor TEXT         NULL,
  submitted_at           DATETIME     NULL,
  created_at             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY rpp_reviews_paper_reviewer_round (paper_id, reviewer, round),
  KEY rpp_reviews_paper_idx (paper_id),
  KEY rpp_reviews_reviewer_idx (reviewer),
  CONSTRAINT rpp_reviews_status_chk CHECK (status IN ('DRAFT','SUBMITTED')),
  CONSTRAINT rpp_reviews_recommendation_chk CHECK (recommendation IS NULL OR
    recommendation IN ('ACCEPT','MINOR_REVISION','MAJOR_REVISION','REJECT')),
  CONSTRAINT rpp_reviews_tq_chk  CHECK (technical_quality IS NULL OR technical_quality BETWEEN 1 AND 5),
  CONSTRAINT rpp_reviews_orig_chk CHECK (originality IS NULL OR originality BETWEEN 1 AND 5),
  CONSTRAINT rpp_reviews_meth_chk CHECK (methodology IS NULL OR methodology BETWEEN 1 AND 5),
  CONSTRAINT rpp_reviews_clar_chk CHECK (clarity IS NULL OR clarity BETWEEN 1 AND 5),
  CONSTRAINT rpp_reviews_submitted_complete CHECK (
    status = 'DRAFT' OR (
      recommendation IS NOT NULL AND submitted_at IS NOT NULL
      AND technical_quality IS NOT NULL AND originality IS NOT NULL
      AND methodology IS NOT NULL AND clarity IS NOT NULL
    )
  ),
  CONSTRAINT rpp_reviews_paper_fk FOREIGN KEY (paper_id)
    REFERENCES rpp_papers (id) ON DELETE CASCADE,
  CONSTRAINT rpp_reviews_reviewer_fk FOREIGN KEY (reviewer)
    REFERENCES rpp_users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 0007 REVISIONS — author revision & resubmission
-- ============================================================================
-- review_ids: uuid[] → JSON array. responses: jsonb → JSON array. At most one
-- OPEN revision per paper: Postgres used a partial unique index on the open
-- statuses; MySQL uses a generated column (paper_id while open, NULL otherwise).
-- REVISION_OVERDUE is derived in the app, never stored.
CREATE TABLE IF NOT EXISTS rpp_paper_revisions (
  id                  CHAR(36)     NOT NULL DEFAULT (UUID()),
  paper_id            CHAR(36)     NOT NULL,
  round               INT          NOT NULL,
  revision_type       VARCHAR(16)  NOT NULL,
  instructions        TEXT         NOT NULL,
  due_at              DATETIME     NULL,
  status              VARCHAR(32)  NOT NULL DEFAULT 'REVISION_REQUESTED',
  review_ids          JSON         NOT NULL,
  responses           JSON         NOT NULL,
  requested_by        CHAR(36)     NULL,
  requested_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at          DATETIME     NULL,
  submitted_at        DATETIME     NULL,
  submitted_by        CHAR(36)     NULL,
  rereview_started_at DATETIME     NULL,
  updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  open_key            CHAR(36)     AS (IF(status IN
                        ('REVISION_REQUESTED','REVISION_IN_PROGRESS','REVISION_SUBMITTED'),
                        paper_id, NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY rpp_paper_revisions_paper_round (paper_id, round),
  UNIQUE KEY rpp_paper_revisions_one_open (open_key),
  KEY rpp_paper_revisions_paper_idx (paper_id),
  CONSTRAINT rpp_paper_revisions_round_chk CHECK (round >= 1),
  CONSTRAINT rpp_paper_revisions_type_chk CHECK (revision_type IN ('MINOR','MAJOR')),
  CONSTRAINT rpp_paper_revisions_status_chk CHECK (status IN
    ('REVISION_REQUESTED','REVISION_IN_PROGRESS','REVISION_SUBMITTED','REVISION_UNDER_REVIEW')),
  CONSTRAINT rpp_paper_revisions_paper_fk FOREIGN KEY (paper_id)
    REFERENCES rpp_papers (id) ON DELETE CASCADE,
  CONSTRAINT rpp_paper_revisions_requested_by_fk FOREIGN KEY (requested_by)
    REFERENCES rpp_users (id) ON DELETE SET NULL,
  CONSTRAINT rpp_paper_revisions_submitted_by_fk FOREIGN KEY (submitted_by)
    REFERENCES rpp_users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 0008/0011 EDITORIAL_DECISIONS — one per (paper, round)
-- ============================================================================
-- A released decision is immutable: Postgres enforced this with a trigger
-- (_rpp_decision_immutable) that still allowed the ON DELETE SET NULL of the
-- decider/releaser and cascade deletes. MySQL has no such trigger here; the
-- decision data-access layer refuses to edit/delete a released row, and the FKs
-- below are ON DELETE SET NULL / CASCADE so account and paper deletion still
-- work. review_ids: uuid[] → JSON. version = optimistic concurrency.
CREATE TABLE IF NOT EXISTS rpp_editorial_decisions (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()),
  paper_id          CHAR(36)     NOT NULL,
  round             INT          NOT NULL,
  decision          VARCHAR(16)  NOT NULL,
  summary           TEXT         NOT NULL,
  confidential_note TEXT         NULL,
  review_ids        JSON         NOT NULL,
  revision_due_at   DATETIME     NULL,
  revision_id       CHAR(36)     NULL,
  version           INT          NOT NULL DEFAULT 1,
  decided_by        CHAR(36)     NULL,
  released_by       CHAR(36)     NULL,
  released_at       DATETIME     NULL,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY rpp_editorial_decisions_paper_round (paper_id, round),
  KEY rpp_editorial_decisions_paper_idx (paper_id),
  KEY rpp_editorial_decisions_released_idx (released_at),
  CONSTRAINT rpp_editorial_decisions_round_chk CHECK (round >= 0),
  CONSTRAINT rpp_editorial_decisions_decision_chk CHECK (decision IN
    ('ACCEPT','MINOR_REVISION','MAJOR_REVISION','REJECT')),
  CONSTRAINT rpp_editorial_decisions_paper_fk FOREIGN KEY (paper_id)
    REFERENCES rpp_papers (id) ON DELETE CASCADE,
  CONSTRAINT rpp_editorial_decisions_revision_fk FOREIGN KEY (revision_id)
    REFERENCES rpp_paper_revisions (id) ON DELETE SET NULL,
  CONSTRAINT rpp_editorial_decisions_decided_by_fk FOREIGN KEY (decided_by)
    REFERENCES rpp_users (id) ON DELETE SET NULL,
  CONSTRAINT rpp_editorial_decisions_released_by_fk FOREIGN KEY (released_by)
    REFERENCES rpp_users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 0009 PUBLICATION MANAGEMENT — volumes, issues, publications
-- ============================================================================
CREATE TABLE IF NOT EXISTS rpp_volumes (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()),
  volume_number INT          NOT NULL,
  year          INT          NOT NULL,
  title         VARCHAR(300) NOT NULL,
  description   TEXT         NOT NULL,
  status        VARCHAR(16)  NOT NULL DEFAULT 'DRAFT',
  published_at  DATETIME     NULL,
  created_by    CHAR(36)     NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY rpp_volumes_year_number (year, volume_number),
  KEY rpp_volumes_status_idx (status),
  CONSTRAINT rpp_volumes_number_chk CHECK (volume_number BETWEEN 1 AND 9999),
  CONSTRAINT rpp_volumes_year_chk CHECK (year BETWEEN 1900 AND 2200),
  CONSTRAINT rpp_volumes_status_chk CHECK (status IN ('DRAFT','SCHEDULED','PUBLISHED')),
  CONSTRAINT rpp_volumes_created_by_fk FOREIGN KEY (created_by)
    REFERENCES rpp_users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- UNIQUE(id, volume_id) exists so the publications composite FK
-- (issue_id, volume_id) can target it — guaranteeing an issue belongs to its
-- stated volume (Postgres: unique (id, volume_id)).
CREATE TABLE IF NOT EXISTS rpp_issues (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()),
  volume_id        CHAR(36)     NOT NULL,
  issue_number     INT          NOT NULL,
  title            VARCHAR(300) NOT NULL,
  description      TEXT         NOT NULL,
  publication_date DATE         NULL,
  status           VARCHAR(16)  NOT NULL DEFAULT 'DRAFT',
  published_at     DATETIME     NULL,
  created_by       CHAR(36)     NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY rpp_issues_volume_number (volume_id, issue_number),
  UNIQUE KEY rpp_issues_id_volume (id, volume_id),
  KEY rpp_issues_volume_idx (volume_id),
  KEY rpp_issues_status_idx (status),
  CONSTRAINT rpp_issues_number_chk CHECK (issue_number BETWEEN 1 AND 999),
  CONSTRAINT rpp_issues_status_chk CHECK (status IN ('DRAFT','SCHEDULED','PUBLISHED')),
  CONSTRAINT rpp_issues_volume_fk FOREIGN KEY (volume_id)
    REFERENCES rpp_volumes (id) ON DELETE RESTRICT,
  CONSTRAINT rpp_issues_created_by_fk FOREIGN KEY (created_by)
    REFERENCES rpp_users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One publication per paper. authors: jsonb → JSON (names + affiliations, no
-- emails). keywords: text[] → JSON. doi uniqueness is case-insensitive via a
-- generated lower-cased column (Postgres: partial unique on lower(doi)).
-- Public visibility (publication PUBLISHED + issue PUBLISHED + volume PUBLISHED)
-- and the "safe columns only" column grants are enforced in lib/publicCatalog.js
-- (MySQL has no column-level SELECT grants for the app's single user).
CREATE TABLE IF NOT EXISTS rpp_publications (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()),
  paper_id          CHAR(36)     NOT NULL,
  volume_id         CHAR(36)     NOT NULL,
  issue_id          CHAR(36)     NOT NULL,
  title             VARCHAR(500) NOT NULL,
  abstract          TEXT         NOT NULL,
  authors           JSON         NOT NULL,
  keywords          JSON         NOT NULL,
  page_start        INT          NULL,
  page_end          INT          NULL,
  doi               VARCHAR(191) NULL,
  doi_lc            VARCHAR(191) AS (LOWER(doi)) STORED,
  publication_date  DATE         NULL,
  manuscript_id     CHAR(36)     NULL,
  manuscript_public TINYINT(1)   NOT NULL DEFAULT 0,
  status            VARCHAR(16)  NOT NULL DEFAULT 'SCHEDULED',
  version           INT          NOT NULL DEFAULT 1,
  scheduled_by      CHAR(36)     NULL,
  scheduled_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_by      CHAR(36)     NULL,
  published_at      DATETIME     NULL,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY rpp_publications_paper_key (paper_id),
  UNIQUE KEY rpp_publications_doi_key (doi_lc),
  KEY rpp_publications_issue_idx (issue_id),
  KEY rpp_publications_status_idx (status),
  KEY rpp_publications_volume_idx (volume_id),
  CONSTRAINT rpp_publications_status_chk CHECK (status IN ('SCHEDULED','PUBLISHED')),
  CONSTRAINT rpp_publications_page_range_chk
    CHECK (page_end IS NULL OR (page_start IS NOT NULL AND page_end >= page_start)),
  CONSTRAINT rpp_publications_published_complete_chk
    CHECK (status = 'SCHEDULED' OR (published_at IS NOT NULL AND publication_date IS NOT NULL)),
  CONSTRAINT rpp_publications_paper_fk FOREIGN KEY (paper_id)
    REFERENCES rpp_papers (id) ON DELETE RESTRICT,
  CONSTRAINT rpp_publications_volume_fk FOREIGN KEY (volume_id)
    REFERENCES rpp_volumes (id) ON DELETE RESTRICT,
  CONSTRAINT rpp_publications_issue_in_volume_fk FOREIGN KEY (issue_id, volume_id)
    REFERENCES rpp_issues (id, volume_id) ON DELETE RESTRICT,
  CONSTRAINT rpp_publications_manuscript_fk FOREIGN KEY (manuscript_id)
    REFERENCES rpp_paper_manuscripts (id) ON DELETE RESTRICT,
  CONSTRAINT rpp_publications_scheduled_by_fk FOREIGN KEY (scheduled_by)
    REFERENCES rpp_users (id) ON DELETE SET NULL,
  CONSTRAINT rpp_publications_published_by_fk FOREIGN KEY (published_by)
    REFERENCES rpp_users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
