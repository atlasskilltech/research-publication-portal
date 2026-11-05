# External Authors — AIDC – ATLAS International Design Conference 2026

People outside ATLAS SkillTech University can register as **Authors** and submit
papers through the existing portal workflow. `AUTHOR` is a third account type
next to Student and Faculty — not a separate system.

## Registration and Google Sign-In

1. `/register` → **Author** (or `/register?type=author`, linked from `/login`).
2. Required fields: Full name, Email, Phone, Organization / Institution, Current
   status (Working Professional, Student, Researcher, Independent Researcher,
   Other), Designation / Job role / Course / Area of study, Organization /
   Institution location. Validated in the browser and again on the server
   (`lib/authorRegistration.js`, shared).
3. `POST /api/register/author` stores a **pending** registration
   (`research_author_registrations`, SHA-256 of a random token, 30-minute
   expiry) and puts the raw token in an httpOnly cookie (`rpp_author_reg`,
   path `/auth`). **No account exists yet.** An email that already has an
   account is refused (409).
4. **Continue with Google** (`POST /auth/google`, `intent=author`): the pending
   registration is found from the cookie, linked to the single-use OAuth state
   row, and the registered email is sent as `login_hint`. The `hd` (ATLAS
   domain) account-chooser hint is omitted.
5. `/auth/callback` runs every existing check (state + cookie, PKCE, RS256
   signature, issuer, audience, azp, expiry, iat, nonce) and then requires
   `email_verified === true` and the Google email to **exactly** match the
   registered email (case-insensitive). Then, in one transaction: AUTHOR account
   (non-admin, no roles, no password, email verified) + author profile + Google
   identity link; the pending row is consumed (single use). The user is signed
   in, sent to `/dashboard`, and receives one confirmation email (SendGrid,
   idempotent per user).
6. Returning Authors use **Author sign-in with Google** on `/login`
   (`intent=author_signin`, no `hd` hint).

Refusals: mismatch → `author_email_mismatch`; expired/used registration →
`author_registration_expired`; unverified → `google_external_unverified`; an
unregistered non-university Google account → `google_external_not_registered`
(never creates an account).

Unchanged: Student/Faculty still require a verified `@atlasuniversity.edu.in`
Google account (with `hd`); the `sf48116@gmail.com` testing exception still
works for Student/Faculty registration and still cannot use Google; password
login/reset are unchanged. A non-university Google email can only ever sign in
to an AUTHOR account, and no flow converts an existing account's type.

## Permissions

Authors are submitters: own dashboard, submit papers, own submissions and
status, revision uploads, released decisions, notifications (all through the
existing ownership checks). Server-side guards:

- `setUserRoles` refuses any role (incl. ADMINISTRATOR) for an AUTHOR account
  (`RPP_AUTHOR_ROLES` → 422), so Authors can't be assigned as SPOC, reviewer or
  editor either (assignment requires the role).
- `getSessionUser` never reports `isAdmin` or roles for an AUTHOR account, even
  if a row were edited by hand.
- `/api/editorial` returns 403 for Authors; every admin, reviewer, editor,
  publication and volume API already refuses them.

## Database — migration `004_author_role.mjs` (additive)

| Change | Purpose |
| --- | --- |
| `research_users.baseType` enum + `'AUTHOR'` (appended) | account type; existing values/rows unchanged |
| `research_author_profiles` (FK → users, ON DELETE CASCADE) | phone, organization, current status, designation, location, conference |
| `research_author_registrations` | pending registrations (hashed token, expiry) |
| `research_oauth_states.author_registration_id` (nullable) | links an OAuth flow to the pending registration |

Rollback (`npm run db:migrate -- --rollback 004 --yes`) refuses while any
AUTHOR account or profile exists.

**Deployment.** The GitHub Actions deploy runs `npm run db:deploy-migrate`
after `npm ci` and before `npm run build`. With nothing pending it does nothing.
With a pending migration it takes a fresh backup of only the `research_*`
tables (`RPP_BACKUP_DIR`, default `~/rpp-backups`, mode 0600), verifies it,
applies the migration, and verifies the schema and that every existing table's
row count is unchanged. Any failure stops the deploy before build/reload.

## Google Cloud Console (manual)

The OAuth consent screen must be **External / In production** (see
`google-sign-in-setup.md` step 3), otherwise Google blocks non-ATLAS accounts.

## Tests

- `npm run test:author-registration` — offline, real RS256 tokens (form
  validation, all statuses, Gmail / IIT / NIT / university accounts, match &
  mismatch, unverified, unregistered, expired/replayed registrations,
  Student/Faculty rules, `sf48116@gmail.com`, no role change, emails).
- `npm run test:author-mysql` — throwaway MySQL database: 004 on an existing
  001–003 database (all rows unchanged), backup + restore, idempotency,
  repositories, role refusal, guarded rollback.
- `node scripts/test-author-http.mjs <url>` — against a running app: the
  registration API, Google start, Author authorization.
- `E2E_AUTHOR_BASE_TYPE=AUTHOR node scripts/test-e2e-live.mjs <url>` — the full
  submission → review → revision → decision → publication workflow with an
  external Author.
