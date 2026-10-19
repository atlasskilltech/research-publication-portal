# Implementation Roadmap — Research Publication Portal

**Status:** Planning only — nothing below has been built. Begin coding only after sign-off on `open-questions-and-assumptions.md`.
**Stack (fixed):** Next.js App Router · JavaScript only · Tailwind CSS v4 · PostgreSQL · Prisma · Auth.js · object storage + signed URLs.

Legend: **MVP** = required for a usable first release · **Later** = enhancement.

---

## Dependency overview

```
P0 Audit & sign-off
      │
P1 Foundation (Next.js/Tailwind/lint/env)
      │
P2 Database & data model ──────────────┐
      │                                │
P3 Auth & account lifecycle            │
      │                                │
P4 Per-paper RBAC policy layer  ◄──────┘   (depends on P2 + P3)
      │
P5 Shared UI shell + dashboards
      │
P6 Submission & document mgmt ─► P7 Desk screening ─► P8 Peer review ─► P9 Editorial + volumes
      │                                                                        │
P10 SPOC + Admin (users/roles/import)  ◄── needs P4                            │
      │                                                                        │
P11 Notifications & audit  ◄── cross-cuts P6–P10                               │
      │                                                                        │
P12 Responsive & a11y refinement                                              │
      │                                                                        │
P13 Security + functional testing ─► P14 Performance & deployment ─► P15 Prod verify/backup
```

Critical path: **P0 → P1 → P2 → P3 → P4** must be solid before any role feature. P4 (RBAC) is the single highest-risk item and gates everything role-specific.

---

## Phase 0 — Reference audit & requirement approval
- **Objective:** Lock confirmed vs proposed scope; get institutional answers to open questions.
- **Dependencies:** none.
- **Tasks:** review this doc set with stakeholders; decide storage (Drive vs object), email provider, Admin↔SPOC reviewer-assignment split, revision/withdrawal rules, blind-review depth.
- **Deliverables:** signed-off requirements; answered open-questions log.
- **Acceptance:** stakeholders approve the role matrix and lifecycle; no P-items block MVP.

## Phase 1 — Technical foundation
- **Objective:** Running Next.js App Router skeleton.
- **Tasks:** create app (JS, App Router), Tailwind v4 with brand `@theme` tokens (ATLAS indigo/teal/pink + 4 school colours), ESLint/Prettier, env schema, folder structure (see PDF §16), base layout, favicon from square ATLAS tile.
- **Files:** `app/layout.js`, `app/globals.css`, `tailwind`/`@theme`, `lib/env.js`, `components/ui/*`.
- **Security:** secrets only in env; no secrets committed.
- **Acceptance:** app builds, lints clean, brand tokens render; no TypeScript files.

## Phase 2 — Database & data model
- **Objective:** Schema for the whole workflow with non-destructive history.
- **Tasks:** model `schools`, `programmes`, `users`, `papers`, `paper_roles` (per-paper assignments), `desk_reviews`, `peer_reviews` (round R1/R2, append-only), `editorial_decisions`, `volumes`, `volume_papers`, `notifications`, `audit_log`; constraints, indexes, enums; seed schools/programmes.
- **Files:** `prisma/schema.prisma`, `prisma/seed.js`, `lib/db.js`.
- **DB changes:** initial migration.
- **Security:** no PII beyond need; grades/decisions immutable via new rows, not overwrites.
- **Acceptance:** migrations run; ERD matches PDF §11; review history is additive.

## Phase 3 — Authentication & account lifecycle
- **Objective:** Secure sign-in/registration.
- **Tasks:** Auth.js credentials; registration (Student/Faculty toggle, roll-no for students, university-email rule); password hashing (argon2/bcrypt); session cookies (httpOnly, secure, sameSite); **[confirm] email verification + account approval**; password reset **[no reference screen — propose]**.
- **Files:** `app/(auth)/login`, `app/(auth)/register`, `app/api/auth/**`, `lib/auth.js`.
- **Security:** rate-limit login/register; generic auth errors; no privileged self-registration.
- **Acceptance:** register → verify/approve → login → session; abuse paths rate-limited.

## Phase 4 — Per-paper role & permission enforcement *(highest risk)*
- **Objective:** One server-side policy layer used everywhere.
- **Tasks:** `can(user, action, paperId)`; resolve roles from `paper_roles`; visibility rule (submitter + assigned + admin); **conflict check** (no role on own paper); single-blind field redaction at the query layer; Admin override.
- **Files:** `lib/rbac/policy.js`, `lib/rbac/visibility.js`, middleware guard, server-action wrappers.
- **Security:** deny-by-default; every read/write passes policy; tests for cross-role leakage.
- **Acceptance:** cross-role access tests pass; API never returns hidden fields; assigning a role to a paper's author is blocked and logged.

## Phase 5 — Shared UI shell, navigation & dashboards
- **Objective:** Role-aware app shell.
- **Tasks:** responsive sidebar (per-role nav sets), "Signed in as" card, **role switcher** ("Viewing as ▾"), KPI cards, 5-phase timeline, scope banner ("Showing only papers assigned to you…"), reusable table/badge/chip components (phase chips P1–P5, status badges).
- **Files:** `components/layout/Sidebar.jsx`, `RoleSwitcher.jsx`, `components/papers/PapersTable.jsx`, `components/ui/*`.
- **Acceptance:** each role sees correct nav; dashboards render KPIs + timeline; mobile drawer works.

## Phase 6 — Paper submission & document management (MVP core)
- **Objective:** Create/track papers.
- **Tasks:** Submit form (Paper ID, school→programme, title, author prefill, batch, guide, themes, Drive link / **[+ object-storage upload if approved]**); auto-enter Phase 1; **edit-lock after shortlisting**; My Submissions table + filters; paper detail (Overview).
- **Security:** validate Paper-ID format/uniqueness; file type/size/content checks if uploads enabled; owner-only edit pre-shortlist.
- **Acceptance:** submit → appears in My Submissions as P1/pending; edits lock at shortlist.

## Phase 7 — Desk screening (Turnitin)
- **Objective:** Phase-2 gate.
- **Tasks:** desk panel (copy Drive link, open Turnitin, record Similarity %, AI %, report URLs, notes); **Pass → Phase 3** / **Fail**; desk status PENDING/PASS/FAIL; hide peer/editor data from desk reviewer.
- **Acceptance:** recording results advances/fails correctly; desk reviewer cannot see downstream data.

## Phase 8 — Peer review workflow
- **Objective:** Blind R1 + R2.
- **Tasks:** review form (Accept/Revise/Reject + comments + optional revision link); append-only reviews; both-accept rule → "Ready for Volumes"; no-access screen; redact co-reviewer/desk/editor data.
- **Acceptance:** R1 & R2 independent and blind; both Accept flips readiness; prior reviews never overwritten.

## Phase 9 — Editorial decisions & revisions
- **Objective:** Finalise + volumes.
- **Tasks:** editor final decision (Accept/Request revision/Reject); Volumes board (create, Fill smartly ≤10, Cover, Lock, recipients, send to publishing); Archive (Download PDF, Restore); **[confirm revision resubmission loop]**.
- **Security/Transactions:** decision + volume lock run in transactions; locked/archived volumes read-only.
- **Acceptance:** accepted-and-both-rounds papers become volume-eligible; lock→archive is auditable and reversible only by permitted roles.

## Phase 10 — SPOC & administrative workflows
- **Objective:** Shortlist/grade, assign, import, user management.
- **Tasks:** SPOC shortlist + grade + reviewer assignment; **Assign role** modal with live conflict check + visibility panel; People & roles (add/manage, filter by role); **bulk import** (CSV/Excel upsert on `paper_id`, school-prefix inference, dry-run preview, validation report).
- **Security:** only Admin manages people/roles; import validated server-side + fully audited.
- **Acceptance:** per-paper assignment works and is conflict-safe; import upserts correctly with an audit entry per row.

## Phase 11 — Notifications & audit history
- **Objective:** Activity feed + accountability.
- **Tasks:** activity entries (ROLE/INFO/DECISION/ASSIGNMENT), mark-read, "view paper"; wire **email (Resend/SendGrid)** replacing the mock; immutable audit log for every state change/assignment (incl. "Assignment blocked").
- **Acceptance:** key events produce activity + email; audit log is append-only and complete.

## Phase 12 — Responsive refinement & accessibility
- **Tasks:** sidebar→drawer, tables→stacked cards on mobile, long-form submission UX, modals full-screen on small screens, 44px touch targets, keyboard nav, focus states, ARIA, contrast on school colours.
- **Acceptance:** WCAG 2.1 AA spot-checks pass; usable at 360px width; keyboard-only flows work.

## Phase 13 — Security & functional testing
- **Tasks:** unit (policy, validators), integration (API+DB), E2E (submit→publish), **cross-role access tests**, file up/download tests, lifecycle-transition tests, auth/authz tests.
- **Acceptance:** green suite; no cross-role leakage; critical transitions covered.

## Phase 14 — Performance optimisation & deployment
- **Tasks:** query/index tuning, pagination on large tables, caching where safe, build optimisation; deploy to Node host (NOT XAMPP); env/migrations/CI; object storage + email keys live.
- **Acceptance:** acceptable load times on realistic data; reproducible deploy.

## Phase 15 — Production verification, backup & maintenance
- **Tasks:** smoke tests in prod; automated encrypted DB backups + restore drill; monitoring/alerts; runbook; backup of object storage.
- **Acceptance:** verified backup/restore; monitoring live; rollback documented.

---

## MVP recommendation

**MVP (one full cycle, end to end):** P0–P9 + the SPOC/Admin essentials of P10 (shortlist, assign role with conflict check, people & roles) + basic P11 (activity feed; email can stay mocked for internal pilot) + P13 access tests.

**Safe to defer:** bulk CSV import, Turnitin API (keep manual), object-storage upload if Drive links suffice for pilot, SSO (keep credentials), advanced analytics filters, archive restore, PDF volume export, author-blind masking.

**Do-not-build-yet (needs confirmation first):** withdrawal flow, multi-author/co-author UI, resubmission-round automation — all are proposed, not evidenced.
