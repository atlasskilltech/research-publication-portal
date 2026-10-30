# System Architecture Summary — Research Publication Portal..

**Project:** Research Publication Portal — ATLAS SkillTech University
**Status:** Foundation built. The shared UI shell exists; authentication, accounts and sessions run on **Supabase Auth + PostgreSQL**.
**Companion docs:** `requirements-and-role-matrix.md`, `implementation-roadmap.md`, `open-questions-and-assumptions.md`, and the PDF blueprint (`research-publication-portal-system-architecture-blueprint.pdf`). All must stay consistent.

> **Architecture update (as built, current).** The datastore is **Supabase PostgreSQL** and authentication is **Supabase Auth** (via `@supabase/ssr`), with access control enforced by **Row Level Security**. User profiles and the admin flag live in `public.profiles`; the schema is versioned in `supabase/migrations/`. There is **no MySQL, no `mysql2`, no ORM, and no custom session or bcrypt code** — those were removed during the Supabase migration. Wherever the sections below mention MySQL, `mysql2/promise`, Prisma, Auth.js, bcryptjs, custom server-side sessions, or object storage, read **Supabase Auth + Supabase PostgreSQL + RLS** (uploaded manuscripts are referenced by link in the current mock UI, with no object storage) — those references reflect the original plan and are superseded here.

---

## 1. In one paragraph (plain English)

The portal is a single institutional web application that moves a research paper through five supervised stages — SPOC shortlist, desk (plagiarism/AI) screening, two rounds of blind peer review, and editorial volume assembly — while making sure each paper is only ever seen by the people officially attached to it. The thing that makes it more than a dashboard is **per-paper role-based access control**: the same person can be an author on their own paper, a peer reviewer on someone else's, and nothing at all on a third, and the system must enforce those boundaries on the **server**, for every request, not just by hiding buttons.

**Analogies:** *Frontend* = the reception desk and forms you see. *Backend* = the office staff who check the rules before doing anything. *Database* = the filing cabinets. *Authentication* = checking your ID at the door. *Authorization* = deciding which filing cabinets your ID lets you open. *API* = the internal request slips passed between desk and back office.

---

## 2. Recommended architecture (and why)

**Recommendation: a modular Next.js (App Router) application with server-side route handlers + a MySQL relational database accessed directly via `mysql2/promise`, deployed on a Node-capable host — NOT a separate microservice backend, and NOT XAMPP/PHP in production.**

### Why a modular monolith, not microservices
The whole system is one tightly-coupled workflow over one dataset (papers, roles, reviews). Splitting it into services would add network calls, distributed transactions and deployment overhead for no real scaling benefit at institutional volume (~1,000 papers/cycle). A **modular monolith** — one deployable unit with clean internal module boundaries (`auth`, `papers`, `reviews`, `volumes`, `rbac`, `notifications`, `audit`) — gives the maintainability of separation without the operational cost. It can be split later if a module genuinely needs independent scaling.

### Why Next.js route handlers / server actions are enough
Next.js App Router can host both the UI and the secure server logic (Route Handlers under `app/api/**` and Server Actions). All authorization runs server-side in a shared **policy layer** that every handler calls. A separate Express/Nest backend is **not justified** here; it would duplicate auth and models.

### Why MySQL (relational)
The data is deeply relational and integrity-critical: papers ↔ per-paper role assignments ↔ reviews ↔ decisions ↔ volumes, with history that must never be overwritten. A relational DB gives foreign keys, unique constraints, indexes and **transactions** (essential for "shortlist", "record decision", "lock volume"). **MySQL** is the chosen database. It is accessed directly from JavaScript via **`mysql2/promise`** using parameterized SQL (no ORM); schema and changes are hand-written, reviewed SQL in `db/schema.sql`.

### Required frontend stack (fixed by the brief)
Next.js **App Router**, **JavaScript only (no TypeScript)**, **Tailwind CSS v4**, mobile-first, reusable components, accessible semantic HTML. No Pages Router, no stray CSS files.

---

## 3. Chosen building blocks (recommended, each a confirmable decision)

| Concern | Recommendation | Rationale |
|---|---|---|
| Framework | Next.js 15+ App Router (JS) | Required; unifies UI + secure server code |
| Styling | Tailwind CSS v4 (CSS-first `@theme` tokens) | Required; brand tokens for ATLAS + 4 school colours |
| Auth | **Custom server-side sessions** (credentials + bcryptjs; random token in httpOnly cookie, SHA-256 hash stored in MySQL; no Auth.js, no `AUTH_SECRET`); add institutional **SSO (SAML/OIDC)** later | Email is university-domain; SSO is the natural production path |
| Authorization | Custom **server-side policy module** (`can(user, action, paper)`) | Per-paper RBAC is bespoke; must be centralised & tested |
| Database | MySQL | Relational integrity + transactions |
| DB access | `mysql2/promise` (direct, parameterized SQL; no ORM) | Simple, explicit queries; schema in `db/schema.sql` |
| File storage | S3-compatible object storage + signed URLs; Google Drive link as interim/fallback | Private research must not be public; DB stores references only |
| Plagiarism/AI | Manual Turnitin capture (MVP) → API later | Matches prototype; low initial complexity |
| Email | Resend or SendGrid (currently mocked) | Activity feed already models notifications |
| Background jobs | Lightweight queue (e.g. cron route + DB queue, or a hosted queue) for emails/exports | Keeps requests fast |
| Hosting | Node host: Vercel, a container (Docker) on a VPS, or institutional Node server | **XAMPP/Apache+PHP cannot run a Next.js server** |
| Observability | Structured logs + error tracking (e.g. Sentry) + DB-backed audit log | Institutional accountability |

---

## 4. How a request travels (round trip)

1. **Browser** requests a page or calls an API route (cookie-based session attached).
2. **Next.js middleware / route handler** runs on the server; it resolves the **session** (who you are — *authentication*).
3. The handler calls the **policy layer**: *is this user allowed to do this action on this specific paper?* (*authorization*). For a paper view it checks: are you the submitter, an assigned role on this paper, or Admin?
4. If allowed, the **data layer** (`mysql2/promise`, parameterized SQL) runs queries/transactions against MySQL. Writes that span tables (shortlist, decision, volume lock) run inside a **transaction** and append to the **audit log** + **activity/notifications**.
5. File links resolve to **signed, time-limited URLs** (or the stored Drive link).
6. The server returns only the data this user is permitted to see (e.g. a peer reviewer never receives the other reviewer's report in the payload — not just hidden in CSS).
7. The **browser** renders the result with reusable, accessible, responsive components.

---

## 5. Architecture layers (text diagram)

```
┌───────────────────────────────────────────────────────────────┐
│ CLIENT (mobile-first, Tailwind v4, accessible components)       │
│  Public: Login · Register    App shell: role-aware sidebar      │
└───────────────▲───────────────────────────────┬────────────────┘
                │ HTTPS (session cookie)         │
┌───────────────┴───────────────────────────────▼────────────────┐
│ NEXT.JS SERVER (App Router)                                     │
│  Route Handlers / Server Actions                                │
│  ├─ AUTH (custom server-side session)                           │
│  ├─ POLICY / RBAC  ← every write & read passes through here      │
│  ├─ Feature modules: papers · screening · reviews · decisions · │
│  │                   volumes · import · users · notifications    │
│  └─ AUDIT (append-only)                                          │
└───────┬───────────────────┬───────────────────┬────────────────┘
        │ mysql2            │ signed URLs        │ API keys
┌───────▼──────┐   ┌────────▼────────┐   ┌───────▼──────────────┐
│ MySQL        │   │ Object storage  │   │ External services     │
│ (relational, │   │ (manuscripts,   │   │ Email (Resend/SendGrid)│
│ transactions)│   │ volume PDFs)    │   │ Turnitin · Drive      │
└──────────────┘   └─────────────────┘   └──────────────────────┘
```

---

## 6. Security posture (headline)

- **Server-enforced per-paper RBAC** — hiding a button is never the control; the policy layer re-checks on every request and the API never returns data the caller may not see.
- **Least privilege:** registration grants only Submitter; SPOC/Desk/Peer/Editor are granted per paper by Admin (SPOC may assign reviewers on its papers — scope to confirm). No self-registration into privileged roles.
- **Separation of duties:** a hard, server-side conflict check prevents reviewing/grading/editing your own paper (mirrors the "Conflict — can't assign" modal).
- **Confidentiality:** single-blind — reviewers' payloads exclude desk results, the peer co-reviewer's report, and the editor's decision.
- **Private files:** object storage + signed URLs; validate type/size/content; protected downloads.
- **Standard web hardening:** input validation, parameterised queries (ORM), output encoding (React), CSRF protection on mutations, rate limiting on auth/import, secrets in env vars, safe error messages, append-only audit trail, encrypted backups.

Full detail in the PDF (Security Architecture) and `open-questions-and-assumptions.md`.

---

## 7. Environments

| Environment | Purpose | Notes |
|---|---|---|
| **Local dev** | Build features | Next.js dev server + local MySQL (e.g. XAMPP's MySQL/MariaDB on 3306). **XAMPP's Apache/PHP is not the runtime** — Next.js needs Node; only its MySQL is used. |
| **Staging** | Pre-release testing | Mirrors prod; seed/anonymised data; email provider in test mode |
| **Production** | Live | MySQL, object storage, real email keys, backups, monitoring |

---

## 8. What is explicitly deferred / to confirm

Google Drive vs object storage for manuscripts; Turnitin manual vs API; exact Admin↔SPOC split of reviewer-assignment authority; revision/resubmission loop detail; withdrawal flow; author-blind (double-blind) vs current single-blind; password-reset & email-verification flows (no reference screens). See `open-questions-and-assumptions.md`.
