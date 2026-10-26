# Open Questions & Assumptions — Research Publication Portal

**Status:** Planning only. These items must be resolved (or explicitly accepted as assumptions) **before** the relevant build phase. Nothing here has been implemented.
**Source note:** Based on local inspection of 59 reference PNGs. **No live Figma document/URL was provided**, so anything not visible in a screenshot is a proposal, not a fact.

Priority: **P0** = blocks MVP architecture/DB · **P1** = blocks a specific feature · **P2** = enhancement/later.

---

## A. Access control & roles

| # | Question | Why it matters | Recommendation | Pri |
|---|---|---|---|---|
| A1 | **Who assigns reviewers — Admin only, or SPOC too?** Reviewer-assignment dropdowns appear on **both** Admin and SPOC paper-detail screens, yet registration text says "An administrator assigns reviewer, SPOC and editor roles." | Determines the policy layer's write rules. | Admin assigns SPOC & Editor (and anything); SPOC may assign **Desk + Peer** reviewers **on papers assigned to it**. Confirm this split. | P0 |
| A2 | **Is review single-blind or double-blind?** References say "Author is shown to every assigned role" (single-blind) but mention "Blind Peer Review". | Affects what the API returns and UI shows. | Implement **single-blind** as evidenced (author visible to assigned roles; reviewers can't see desk/co-reviewer/editor). Add optional author-masking later if required. | P1 |
| A3 | Can one account hold **multiple functional roles on the *same* paper** (e.g. Peer R1 and SPOC)? Role switcher shows multi-role across *different* papers only. | Edge-case in policy + UI. | Assume **one functional role per person per paper** (plus the hard self-conflict block). Confirm. | P1 |
| A4 | Exact Admin provisioning: how is the **first/other Admins** created and changed? No UI seen beyond a fixed Admin. | Privileged-access governance. | Seed one Admin; Admin-to-Admin promotion via Users screen with audit + second-person approval **[propose]**. | P0 |

## B. Accounts & authentication

| # | Question | Recommendation | Pri |
|---|---|---|---|
| B1 | Is there **email verification** before an account is active? (No screen in references.) | Verify university email before first login. | P1 |
| B2 | Is there an **account approval/activation** step by Admin? Register text implies accounts are usable immediately as Submitters. | Assume auto-active as Submitter after email verification; no approval gate for submitters. Confirm. | P1 |
| B3 | **Password reset / forgot password** — no screen exists. | Provide standard tokenised reset; design the screen. | P1 |
| B4 | Allowed email domains (must it be `@…university.edu`/`@atlasuniversity.edu.in`?) and password policy (prototype says "min 6 characters" — weak). | Restrict to institutional domains; raise to ≥10 chars + checks. | P1 |
| B5 | Will production use **institutional SSO (SAML/OIDC)** instead of passwords? | Start with credentials; plan SSO. | P2 |

## C. Papers, files & lifecycle

| # | Question | Recommendation | Pri |
|---|---|---|---|
| C1 | **Manuscript storage:** keep **Google Drive links** (as in prototype) or move to **private object storage with uploads**? Drive links can be public/edited and are hard to secure/audit. | Add secure object storage + signed URLs for production; keep Drive link as optional/fallback. | P0 |
| C2 | **Multiple authors / co-authors?** Submit form has a single author field. | Likely needed for real papers; design a `paper_authors` table + UI. Confirm before DB freeze. | P1 |
| C3 | **Revision loop:** peer "Revise" and editor "Request revision" exist, plus an optional "revision received link", but no full resubmission UI/state. How many rounds? Who re-opens edit lock? | Model a `REVISION_REQUESTED` state + new file version; cap rounds (e.g. 2). Confirm. | P1 |
| C4 | **Withdrawal:** can a submitter withdraw a paper? Not in references. | Propose an Admin/SPOC-initiated withdrawal with reason + audit; confirm if submitters may self-withdraw. | P2 |
| C5 | **Paper-ID scheme:** who mints IDs (user types them: "e.g. ISDI-12"), and are they guaranteed unique/formatted? Import upserts on `paper_id`. | Enforce unique, prefix-validated IDs; consider server-generated IDs to avoid collisions. | P1 |
| C6 | **Exact phase/status enumerations** and every allowed transition (e.g. can a Failed desk paper be reopened? can Rejected be appealed?). | Adopt the transition table in the PDF (§9) as the proposed baseline; confirm reversibility rules. | P0 |
| C7 | Grade scale definition and ordering (O, A+, A, …) and the **grade cut-off** used for the Phase-1 shortlist "by Grade". | Confirm official grade list + shortlist threshold. | P1 |

## D. Desk screening (Turnitin)

| # | Question | Recommendation | Pri |
|---|---|---|---|
| D1 | Manual Turnitin capture (paste %s + URLs) vs **Turnitin API** integration? | Manual for MVP (matches prototype); evaluate API later. | P2 |
| D2 | Are there **threshold rules** (e.g. similarity > X% ⇒ auto-fail or mandatory fail)? | Define similarity/AI thresholds as policy; confirm numbers. | P1 |

## E. Volumes & publication

| # | Question | Recommendation | Pri |
|---|---|---|---|
| E1 | What does **"send for publishing"** actually do downstream (generate a volume PDF? notify a publisher? who are "Publications recipients")? | Define the publish handoff + recipient list source. | P1 |
| E2 | Hard rule of **exactly 10 papers/volume and 8 volumes**, or targets? Archive shows volumes with 0 papers. | Treat 10×8 as targets, not hard constraints; confirm. | P1 |
| E3 | **Restore from archive** — who may, and what state does it return to? | Admin/Editor only, returns to Locked, fully audited. Confirm. | P2 |

## F. Notifications, import, integrations

| # | Question | Recommendation | Pri |
|---|---|---|---|
| F1 | Email provider (**Resend vs SendGrid**) and which events email vs in-app only. | Pick one; map each activity type to channel. Currently mocked. | P1 |
| F2 | **Import** governance: who may import (SPOC + Admin seen), dry-run/preview required?, how are role columns (`desk_reviewer,peer_r1,peer_r2,editor`) validated against conflict rules? | Require preview + per-row validation + audit; enforce conflict check on imported role columns. | P1 |
| F3 | Data retention / archival policy per institutional rules (how long are papers, reviews, audit kept?). | Define retention schedule; audit log immutable. | P1 |

## G. Hosting & operations

| # | Question | Recommendation | Pri |
|---|---|---|---|
| G1 | **Where will production run?** XAMPP/Apache+PHP **cannot** host a Next.js server. | Node host: Vercel, Docker/VPS, or institutional Node server + managed Postgres. | P0 |
| G2 | Managed Postgres provider + backup cadence + restore RTO/RPO targets. | Choose provider; automated encrypted daily backups + tested restore. | P1 |
| G3 | Object-storage provider for manuscripts/volume PDFs (if C1 approved). | S3-compatible with private ACLs + signed URLs. | P1 |

---

## Working assumptions adopted for planning (change if wrong)

1. ~1,000 submissions per annual cycle; institutional scale (hundreds of concurrent users max). → modular monolith is sufficient.
2. Single-blind review; author visible to assigned roles. (A2)
3. One functional role per person per paper; self-conflict hard-blocked. (A3)
4. Manuscripts via Drive link for pilot, object storage for production. (C1)
5. Email stays mocked until a provider key is added; app behaves correctly either way. (F1)
6. Phases/statuses follow the baseline lifecycle & transition table in the PDF blueprint. (C6)
7. Production runs on Node + managed Postgres, never on XAMPP. (G1)

**None of these are confirmed by the user or institution yet — they are planning defaults pending sign-off.**
