# IntelligenceOS Agent API

Lets ATLAS IntelligenceOS (https://intelligence.atlasskilltech.app) connect to the portal with an admin-issued key.
It implements spec `atlas-agent-api/1` v1.1 (atlas-Intelligence-os `docs/AGENT_API_SPEC.md`), including §2a "acting as the user".

- **Agent API URL:** `https://research.atlasskilltech.app/agent-api`. It is HTTPS and JSON only.
- **Auth:** send `Authorization: Bearer atl_…` on every request.
  - A missing, wrong, revoked or expired key returns `401`.
  - A valid key calling an action outside its permissions returns `403`.
  - An unknown, disabled or malformed `X-IntelligenceOS-User` returns `403` with a plain reason.
  - Bad parameters return `400`. An unknown action or record returns `404`. A record the acting user may not see also returns `404`.
  - Going over the rate limit returns `429` with a `Retry-After` header.
  - Every error is `{ "error": "…" }`.
- **Log:** each request is written to `research_agent_api_log`. A row holds the time, key, action, `X-IntelligenceOS-Agent`, `X-IntelligenceOS-Run`, `X-IntelligenceOS-User` (column `acting_email`), status and IP.
- **Rate limit:** 120 requests per minute per key by default. Change it with `AGENT_API_RATE_LIMIT_PER_MINUTE`. The counter is in memory, so the limit applies separately to each app process.

## Creating a key (admins)

1. Open **IntelligenceOS keys** in the admin sidebar (`/intelligence-keys`).
2. Click **Create key**, then:
   - Enter a name.
   - Choose permissions: either click a preset (**Read only**, the default, or **Read + write**) or tick the boxes yourself.
   - Set an expiry date.
3. Copy the key. It is shown **once**. The portal stores only `sha256(key)` and the last 4 characters.
4. In IntelligenceOS, go to **Connectors → Connect project** and enter:
   - name: `ATLAS Research`
   - URL: the Agent API URL above
   - the key you copied
   - tick **This project acts as the signed-in user**
5. The list shows the last time each key was used. **Revoke** stops a key immediately: its next request gets `401`.

## Acting as the signed-in user (role-based access)

With **This project acts as the signed-in user** ticked, IntelligenceOS sends
`X-IntelligenceOS-User: <email of the agent's owner>` on every call. For a scheduled agent this is still the agent's owner, not the person who pressed Run.

- The email is matched to an **active** portal account, ignoring case. The person's IntelligenceOS email must be the same as their portal email.
- `GET /manifest` with the header lists only the actions that person's account can use.
- Every action returns only what that person sees in the portal.
- Without the header, the key acts on its own: everything its permissions allow. This is what IntelligenceOS uses while an admin connects the project.

**Security:** with this setup, whoever holds the key can name any portal user. Keep the key only in IntelligenceOS, give it an expiry and revoke it if in doubt.

### Who sees what

A person with several roles sees all of them together. Each paper is shown through the role they hold on **that** paper.

| Person | Papers | View of a paper |
|---|---|---|
| Administrator | Every paper | Manager. On a paper they submitted themselves: author view. |
| Program Chair (role + email in `PROGRAM_CHAIR_EMAILS`) | Papers with a final-approval request | Manager |
| Editor (per paper) | Papers they edit | Manager |
| Desk / Peer Reviewer, SPOC (per paper) | Papers assigned to them | Reviewer |
| Anyone who submitted a paper (student, faculty, AIDC author) | Their own papers | Author |

- **Manager view:** reviewers (display names), review progress and recommendations, decisions with their approval status, revisions, IntelligenceOS notes, status history.
- **Author view:** decisions released to the author, the reviewer comments meant for the author (shown as "Reviewer 1", "Reviewer 2"), revision requests, and the milestones of their own paper. It never includes reviewer identity, assignments or unreleased decisions.
- **Reviewer view:** the paper and the person's own assignment and review. It never includes other reviewers, the desk review or the editor's decision.

Other rules:

- **Achievements:** faculty and students see their own. Administrators see everyone's, with names. AIDC authors have none.
- **People and AIDC registration numbers:** administrators only.
- **Publications and volumes:** everyone sees what is published. Administrators and editors also see drafts and scheduled ones. Authors also see their own scheduled publication.
- **Writes** (`research.write` key only): an administrator, or the editor of that paper. Never on a paper the person submitted. Writes are recorded with the person as actor and `onBehalfOf` = their email.

### Data the API never returns

- Author names or emails, including the `authors` list of a publication. This applies to every role.
- User ids or emails, except the acting user's own email in `whoami` and `/manifest`.
- Confidential reviewer comments and confidential decision notes.
- File names or storage keys.
- AIDC registration names, emails or phone numbers. Only counts are returned.

There are no delete, password or bulk-export actions.

## Actions

All read actions need `research.read` and are `GET`.

| id | path | What it answers | Who (acting user) |
|---|---|---|---|
| `whoami` | `/me` | Who am I, my roles, my submissions by status, my assignments, reviews still to submit, approvals waiting | everyone |
| `list_submissions` | `/submissions?status&department&myRole&from&to&limit` | Papers I can see, with `myRoles` per paper. `myRole` = SUBMITTER, EDITOR, PEER_REVIEWER, DESK_REVIEWER, SPOC or PROGRAM_CHAIR | everyone |
| `get_submission` | `/submissions/{id}` (UUID or reference ID such as `ISDI-2026-0001`) | One paper, in the view above | everyone |
| `submission_stats` | `/stats/submissions?from&to` | Counts by status and department | everyone (own scope) |
| `list_review_assignments` | `/reviews?reviewStatus&overdue&role&mine&submission&limit` | Review assignments, deadlines, overdue, totals | not AIDC authors |
| `list_revisions` | `/revisions?status&open&mine&submission&limit` | Revision requests and their status | everyone |
| `list_decisions` | `/decisions?decision&released&submission&from&to&limit` | Editorial decisions | everyone (authors: released, own) |
| `list_approvals` | `/approvals?status&submission&limit` | Program Chair final approvals | Program Chair, administrators |
| `list_publications` | `/publications?status&year&volume&search&limit` | Journal publications | everyone |
| `list_volumes` | `/volumes?year&status` | Volumes and issues with paper counts | everyone |
| `list_achievements` | `/achievements?type&status&school&mine&from&to&limit` | Faculty achievements with details | not AIDC authors |
| `achievement_stats` | `/stats/achievements?from&to&school` | Achievement counts and amounts by type, status and school | not AIDC authors |
| `list_activity` | `/activity?submission&from&to&limit` | Recent activity on papers | everyone (own scope) |
| `list_users` | `/users?role&accountType&status&search&limit` | Faculty and students with roles and status (no emails) | administrators |
| `registration_stats` | `/stats/registrations` | AIDC author counts | administrators |

`limit` is at most 200 and defaults to 50.

Write actions need `research.write` and are `POST`:

| id | path | permission |
|---|---|---|
| `add_review_note` | `/submissions/{id}/notes` with body `{ note }` (≤ 2000 characters) | `research.write` |
| `update_submission_status` | `/submissions/{id}/status` with body `{ status, reason? }` | `research.write` |

### Allowed status changes

`update_submission_status` permits only these changes:

- `SUBMITTED` → `UNDER_REVIEW` or `ARCHIVED`
- `UNDER_REVIEW` → `ARCHIVED`
- `REJECTED` → `ARCHIVED`

Accept, reject, revision and publish decisions still go through the editorial and Program Chair workflow.

### Where writes are recorded

Notes and status changes are stored in the paper's audit trail (`research_paper_activity`) under these actions:

- `AGENT_NOTE_ADDED`
- `AGENT_STATUS_CHANGED`

Each record includes the agent name, run id and, when acting as a person, `onBehalfOf`. Admins can see these records. Authors cannot.

## Code

- `lib/agentApi/keys.mjs`: scopes, presets, key generation and hashing, the key repository and the request log.
- `lib/agentApi/access.mjs`: the acting user (`X-IntelligenceOS-User`), paper scope in SQL, and the per-paper view (manager, author, reviewer).
- `lib/agentApi/actions.mjs`: the submission actions, the write actions, parameter validation and routing.
- `lib/agentApi/readActions.mjs`: the other read-only actions.
- `lib/agentApi/common.mjs`: shared helpers.
- `lib/agentApi/handler.mjs`: authentication, rate limit, acting user, manifest, routing and logging. It does not depend on the framework.
- `app/agent-api/[[...path]]/route.js`: the Next route. It passes `PROGRAM_CHAIR_EMAILS`.
- `app/api/admin/agent-keys/*`, `app/(app)/intelligence-keys`, `components/manage/AgentKeysAdmin.jsx`: the admin page and its API.
- `database/migrations/010_agent_api.mjs`: creates the tables `research_agent_api_keys` and `research_agent_api_log`.
- `database/migrations/011_agent_api_acting_user.mjs`: adds `research_agent_api_log.acting_email`.

## Tests

The suites below are run with `npm run`:

- `npm run test:agent-api` runs 74 checks against a throwaway database on a local MySQL or MariaDB server.
- `npm run test:agent-api-roles` runs 90 checks against a throwaway database. Every role asks as itself: administrator, Program Chair, editor, peer and desk reviewer, SPOC, student, AIDC author and a multi-role faculty member. The suite also checks that no response leaks author identity, confidential text, file names or user ids.
- `npm run test:agent-api-http -- http://localhost:3001` runs 26 checks against a running app.

## Deploying

1. Run the migration: `node scripts/db-migrate.mjs --apply`. It adds one nullable column.
2. Deploy the app.
3. In IntelligenceOS, edit the ATLAS Research connection and tick **This project acts as the signed-in user**.
