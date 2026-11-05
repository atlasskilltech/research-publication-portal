# External Authors — AIDC – ATLAS International Design Conference 2026

People outside ATLAS SkillTech University can register as **Authors** and submit
papers through the existing portal workflow. `AUTHOR` is a third account type
next to Student and Faculty — not a separate system.

## Registration and sign-in (email + password)

1. `/register` → **Author** (or `/register?type=author`, linked from `/login`).
2. Required fields: Full name, Email, Phone, Organization / Institution, Current
   status (Working Professional, Student, Researcher, Independent Researcher,
   Other), Designation / Job role / Course / Area of study, Organization /
   Institution location, **Password** and **Confirm password** (10–200
   characters, must match — `lib/passwordPolicy.js`). Validated in the browser
   and again on the server (`lib/authorRegistration.js`, shared).
3. `POST /api/register/author` refuses an email that already has an account
   (409), otherwise creates — in one transaction — the AUTHOR account
   (Argon2id hash via `lib/auth/password.mjs`, never plaintext; non-admin, no
   roles) and its profile, starts a normal APP session and sends one
   confirmation email (SendGrid, idempotent per user). The user lands on
   `/dashboard`.
4. Returning Authors sign in on `/login` in the **Author sign-in** section
   (email + password, the existing `/api/login` + session system).
5. **Forgot password** works for Authors (any address with an account; it used
   to be limited to the Student/Faculty registration allow-list).

### Google Sign-In is not available for Authors

`/login` has exactly one **Sign in with Google** button, for Students,
Faculty, Admins, Editors and Reviewers. The callback refuses every AUTHOR
account (`author_google_disabled`), including one with an already linked
Google identity; no session is created. Google never creates an account.

### Authors who previously used Google

Their accounts, profiles, papers and Google link records are kept unchanged.
They set a password with **Forgot password?** on `/login` (a single-use link
to their email; setting it revokes all sessions), or — if still signed in —
from Account settings → Set a password. Then they sign in with email +
password.

### Email ownership

Registration does not send a verification link: the email is marked verified
at registration so the standard password sign-in works. If someone registers
an address they don't own, the real owner can take the account over with
"Forgot password" (which revokes every session). The confirmation email says
so.

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

## Database — migration `004_author_role.mjs` (unchanged)

| Object | Use now |
| --- | --- |
| `research_users.baseType` value `'AUTHOR'` | account type |
| `research_author_profiles` | profile fields |
| `research_author_registrations` | no longer written (earlier Google flow); kept, nothing deleted |
| `research_oauth_states.author_registration_id` | no longer written; kept |

No new migration. Rollback refuses while any AUTHOR account or profile exists.

## Tests

- `npm run test:author-registration` — offline: form + password validation,
  all statuses, registration orchestration, Google refusal for AUTHOR (incl. a
  linked identity, real RS256 tokens), Student/Faculty/Admin/Editor/Reviewer
  Google sign-in unchanged, emails.
- `npm run test:author-mysql` — throwaway MySQL database: 004 on an existing
  001–003 database (all rows unchanged), backup + restore, idempotency,
  repositories, role refusal, guarded rollback.
- `node scripts/test-author-http.mjs <url>` — against a running app:
  registration with password, login, wrong password, password reset, setup for
  a Google-era Author, the login page, Author authorization.
- `E2E_AUTHOR_BASE_TYPE=AUTHOR node scripts/test-e2e-live.mjs <url>` — the full
  submission → review → revision → decision → publication workflow with an
  external Author.
