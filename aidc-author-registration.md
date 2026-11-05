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
4. The user clicks the **same "Sign in with Google" button everyone uses**.
   `/auth/google` sees this browser's pending registration (cookie, read
   server-side only), links it to the single-use OAuth state row and sends the
   registered email as `login_hint`.
5. `/auth/callback` runs every check (state + cookie, PKCE, RS256 signature,
   issuer, audience, azp, expiry, iat, nonce, `email_verified === true`) and
   then decides on the server:
   - **existing account** (by linked Google `sub`, or first use by exact
     email) → signed in with exactly its stored type, admin flag and roles;
     a pending registration never converts or re-roles it;
   - **no account + pending registration** → the Google email must
     **exactly** match the registered email (case-insensitive). Then, in one
     transaction: AUTHOR account (non-admin, no roles, no password, email
     verified) + profile + Google identity link; the pending row is consumed.
     Signed in, sent to `/dashboard`, one confirmation email (SendGrid).
     A mismatch is refused with `author_email_mismatch`;
   - **no account, no registration** → refused (`google_not_registered`);
     Google never creates an account for an arbitrary user.
6. Returning Authors simply use "Sign in with Google" on `/login`.

### Google accounts accepted

Any verified Google account, any domain (Gmail, IIT/NIT, other universities,
other Workspace domains), for every role. Student/Faculty/Admin/Editor/Reviewer
accounts are matched by their verified email exactly like Authors. One extra
rule protects ATLAS addresses: an `@atlasuniversity.edu.in` email must come
from the ATLAS Google Workspace (`hd` claim), so a consumer Google account can
never pose as an ATLAS address. Student/Faculty *registration* still requires
an approved university email (`ALLOWED_EMAIL_DOMAINS` / `ALLOWED_EMAILS`),
unchanged.

Refusals: `author_email_mismatch`, `author_registration_expired`,
`google_unverified`, `google_not_registered`, `google_disabled`,
`google_domain` (ATLAS address not from the ATLAS Workspace, or Google account
linked to a different portal account).

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
