# IntelligenceOS Agent API

Lets ATLAS IntelligenceOS (https://intelligence.atlasskilltech.app) connect to the portal with an admin-issued key.
It implements spec `atlas-agent-api/1` (atlas-Intelligence-os `docs/AGENT_API_SPEC.md`).

- **Agent API URL:** `https://research.atlasskilltech.app/agent-api`. It is HTTPS and JSON only.
- **Auth:** send `Authorization: Bearer atl_…` on every request.
  - A missing, wrong, revoked or expired key returns `401`.
  - A valid key calling an action outside its permissions returns `403`.
  - Bad parameters return `400`. An unknown action or record returns `404`.
  - Going over the rate limit returns `429` with a `Retry-After` header.
  - Every error is `{ "error": "…" }`.
- **Log:** each request is written to `research_agent_api_log`. A row holds the time, key, action, `X-IntelligenceOS-Agent`, `X-IntelligenceOS-Run`, status and IP.
- **Rate limit:** 120 requests per minute per key by default. Change it with `AGENT_API_RATE_LIMIT_PER_MINUTE`. The counter is in memory, so the limit applies separately to each app process.

## Creating a key (admins)

1. Open **IntelligenceOS keys** in the admin sidebar (`/intelligence-keys`).
2. Click **Create key**, then:
   - Enter a name.
   - Choose permissions: either click a preset (**Read only**, the default, or **Read + write**) or tick the boxes yourself.
   - Optionally set an expiry date.
3. Copy the key. It is shown **once**. The portal stores only `sha256(key)` and the last 4 characters.
4. In IntelligenceOS, go to **Connectors → Connect project** and enter:
   - name: `ATLAS Research`
   - URL: the Agent API URL above
   - the key you copied
5. The list shows the last time each key was used. **Revoke** stops a key immediately: its next request gets `401`.

## Actions

| id | method + path | permission |
|---|---|---|
| `list_submissions` | `GET /submissions?status&department&from&to&limit` (limit ≤ 200) | `research.read` |
| `get_submission` | `GET /submissions/{id}`, where id is a UUID or a reference ID such as `ISDI-2026-0001` | `research.read` |
| `submission_stats` | `GET /stats/submissions?from&to` | `research.read` |
| `add_review_note` | `POST /submissions/{id}/notes` with body `{ note }` (≤ 2000 characters) | `research.write` |
| `update_submission_status` | `POST /submissions/{id}/status` with body `{ status, reason? }` | `research.write` |

`GET /manifest` lists only the actions the calling key may use.

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

Each record includes the agent name and run id. Admins can see these records. Authors cannot.

### Data the API never returns

- Author names or emails (double-blind review).
- Reviewer emails or ids. Only reviewer display names are returned.
- Confidential reviewer comments.
- File names.

There are no delete, password or bulk-export actions.

## Code

- `lib/agentApi/keys.mjs`: scopes, presets, key generation and hashing, the key repository and the request log.
- `lib/agentApi/actions.mjs`: action definitions, parameter validation and handlers.
- `lib/agentApi/handler.mjs`: authentication, rate limit, manifest, routing and logging. It does not depend on the framework.
- `app/agent-api/[[...path]]/route.js`: the Next route.
- `app/api/admin/agent-keys/*`, `app/(app)/intelligence-keys`, `components/manage/AgentKeysAdmin.jsx`: the admin page and its API.
- `database/migrations/010_agent_api.mjs`: creates the tables `research_agent_api_keys` and `research_agent_api_log`.

## Tests

The suites below are run with `npm run`:

- `npm run test:agent-api` runs 74 checks against a throwaway database on a local MySQL or MariaDB server.
- `npm run test:agent-api-http -- http://localhost:3001` runs 26 checks against a running app.
