# Requirements & Role Matrix — Research Publication Portal

**Project:** Research Publication Portal — ATLAS SkillTech University ("Portal 2025–26")
**Document status:** Planning only (no application built).
**Evidence base:** 59 local reference PNGs in `reference/figma-design/` (51 UI screens + 8 logo assets). Inspected locally; **no live Figma document or URL was provided**, so all findings come from the supplied screenshots, not from the Figma API.
**Date:** 2026-10-19

Legend: **[C] = Confirmed** by a reference screen · **[P] = Proposed** (reasonable inference, needs institutional sign-off). Every proposed item is also listed in `open-questions-and-assumptions.md`.

---

## 1. Screen inventory (what the references actually contain)

| # | Folder | File | Role | Purpose |
|---|--------|------|------|---------|
| 1 | login | Log in Final v4.png | Public | Sign-in + quick "Enter as" role demo chips |
| 2 | login | Register — Final v4.png | Public | Student registration (Student/Faculty toggle) |
| 3 | login | Register — Final v4 (Faculty).png | Public | Faculty registration variant |
| 4–17 | admin/Admin | Dashboard, Dashboard — ISDI, Dashboard — ISDI (filtered), Dashboard — ISME, Dashboard — LAW, Dashboard — uGDX, Papers, Paper detail, Paper access, Import, Volumes, Archive, Users, Activity | Admin | Full administrative console |
| 18–20 | admin/Overlay | Admin New paper, Admin Assign role, Admin Assign role — conflict | Admin | Create-paper + assign-role modals (incl. conflict state) |
| 21–24 | student | Dashboard, My submissions, Submit paper, Activity | Student (Submitter) | Submitter workspace |
| 25–28 | faculty | Dashboard, My submissions, Submit paper, Activity | Faculty (Submitter) | Submitter workspace (near-identical to student) |
| 29–34 | peer reviewer | Dashboard, Papers, Paper detail, Paper — no access, Papers — role switcher, Activity | Peer Reviewer | Blind review workspace |
| 35–40 | spoc/SPOC | Dashboard, Papers, Import, Paper detail, Papers — role switcher, Activity | SPOC | Shortlist/grade/assign workspace |
| 41 | spoc/Overlay | SPOC New paper | SPOC | Create-paper modal |
| 42–45 | desk reviewer | Dashboard, Papers, Paper detail, Activity | Desk Reviewer | Turnitin screening workspace |
| 46–51 | editor | Dashboard, Papers, Paper detail, Volumes, Archive, Activity | Editor | Final decision + volume assembly |
| 52–59 | logo | 8 ATLAS / 4-school brand assets (full lockup, square app tile, horizontal + school tags, variants) | Branding | Logo system (3 inspected in full; remainder are size/format variants) |

**Not present in references (therefore out of confirmed scope):** password reset / forgot-password, email verification screen, account approval/activation screen, explicit error/loading/empty screens (only inline empty states like "No papers match." seen), reviewer scoring rubric, annotated-file upload, withdrawal flow, double-blind author masking. All listed as open questions.

---

## 2. Confirmed brand & taxonomy

- **Institution:** ATLAS SkillTech University. Product: "Research Publication Portal — Portal 2025–26". [C]
- **Schools (4), each with a colour and an ID prefix:** `ISDI` (School of Design & Innovation — pink), `ISME` (BBA — blue), `uGDX` (B.Tech — red), `LAW` (LLB — orange). **School is inferred from the Paper-ID prefix** when not given. [C]
- **Programme taxonomy varies per school** [C]:
  - ISDI → LEVEL (B.Des / B.Tech / Post-graduate) → specialisations (Product Design, Communication Design & New Media, Animation VFX & Gaming, Design Futures · M.Des, …).
  - ISME (BBA) → batch-year (FYBBA/SYBBA/TYBBA/4th-Yr) → specialisation (ACCA, AIET, DBA, PSY, General BBA).
  - uGDX (B.Tech) → batch-year (FYBTECH…) → specialisation (Robotics, AIDS, ITAIC, AIML).
  - LAW (LLB) → year (FYLLB / SYLLB) → programme (LLB · Bachelor of Laws).
- **Batch** = "year of passing out" (e.g. 2029). [C]
- **Grades:** `O`, `A+`, `A`, … (`—` when ungraded). Grade drives the Phase-1 shortlist. [C]
- **Logo assets to preserve:** full lockup (cube + "ATLAS SKILLTECH UNIVERSITY" + 4 school tags), square app tile (favicon/PWA icon), horizontal lockup. Brand colours: indigo/navy `#2E2A6B`-family, teal cube, magenta/pink accent; school chips pink/blue/red/orange. [C]

---

## 3. Confirmed pipeline (5 phases)

| Phase | Name | Owner role | Gate / target | Key mechanic |
|-------|------|-----------|---------------|--------------|
| P1 | **SPOC Shortlist** | SPOC | funnel to ~500 | Shortlist "by Grade"; SPOC sets/confirms grade, clicks **"Shortlist to Phase 2"** |
| P2 | **Desk Review** | Desk Reviewer | funnel to ~200 | **Turnitin** similarity % + AI-writing % recorded (+report URLs, notes); decision **Pass → Phase 3** or **Fail** |
| P3 | **Blind Peer Review R1** | Peer Reviewer (R1) | — | Single reviewer: **Accept / Revise / Reject** + comments (+ optional "revision received link") |
| P4 | **Blind Peer Review R2** | Peer Reviewer (R2) | funnel to ~80 | Second reviewer; **both R1 and R2 must Accept** for a paper to become "Ready for Volumes" |
| P5 | **Formatting, Editing & Volumes** | Editor | 8 volumes × 10 papers | Editor finalises (Accept / Request revision / Reject), assembles volumes |

Funnel headline (shown on dashboards): **"from 1,000 submissions to 8 volumes of 10"** → 1,000 → 500 → 200 → 80 → 8×10. [C]

**Volume lifecycle:** `Ready → Placed → Locked → Archived` ("sent for publishing"). 10 papers/volume; "Fill smartly" auto-fill; covers; PDF export; restore from archive. [C]

---

## 4. Confirmed access-control model (the heart of the system)

Stated verbatim across Users, Paper-access, Assign-role, role-switcher and no-access screens:

1. **Everyone registers as a Submitter** (base type Student or Faculty). "Every account starts as a Submitter." [C]
2. **Functional roles (SPOC, Desk Reviewer, Peer Reviewer R1/R2, Editor) attach to a *paper*, not a person.** "Roles are assigned per paper, never per person." One account can be Peer Reviewer on one paper and Submitter on another. [C]
3. **Per-paper visibility:** "A paper is visible only to its submitter, the SPOC, reviewers and editor assigned to it, and the Administrator." [C]
4. **Separation of duties (hard block):** "Nobody can review, grade or edit their own paper." The Assign-role modal blocks it ("Conflict — can't assign … A submitter can't review, grade or edit their own paper") and logs an "Assignment blocked" activity entry. [C]
5. **Single-blind review:** reviewers are told "Hidden from reviewers: the desk review, the other reviewer's report and the editor's decision." **Author identity is shown to every assigned role** (not author-blind). [C]
6. **Admin is global:** "Every paper, every person." Admin is a fixed role that "always can open". [C]
7. **Multi-role accounts** switch context via a "Viewing as [role ▾] / Switch role" control. [C]

---

## 5. Role-by-role summary

### 5.1 Base types (registration categories) — Student & Faculty
- **Registration fields** [C]: "I am a" Student/Faculty toggle · Full name · University email · School (dropdown) · **Roll No. (students only)** · Password (min 6 chars). Faculty variant omits Roll No.
- **Nav (Submitter workspace):** Dashboard · My Submissions · Submit Paper · Activity. [C]
- **Submit-paper form** [C]: Paper ID (e.g. ISDI-12) · School · Programme (depends on school) · Title · Author (pre-filled from account) · Batch (year of passing out) · Guide · Themes (comma-separated) · **Google Drive link to manuscript** (no file-upload control in the prototype). Single author field — **no co-author UI** [P: multi-author likely needed].
- **Submit helper rule** [C]: "Your paper enters Phase 1 automatically. An administrator assigns its SPOC and reviewers, and only they can see it. You can update the Drive link and themes until shortlisting begins — after that, edits are locked."
- **My submissions table:** ID · TITLE/STUDENT · SCHOOL · GRADE · PHASE · STATUS · DRIVE. [C]
- **Student vs Faculty differ only** by greeting, identity card, and the pre-filled author field. Both are pure submitters in the references. [C]
- **Cannot:** see others' papers, review/grade, touch volumes. [C]

### 5.2 SPOC (School/Specialisation Point of Contact)
- **Nav:** Dashboard · Papers · **Import** · Activity. [C]
- **Can:** view **assigned** papers only; **Shortlist to Phase 2**; set/confirm **Grade**; **assign Desk Reviewer & Peer Reviewer R1/R2** (dropdowns on paper detail); **create** a paper ("+ New paper"); **bulk-import** papers (CSV/Excel upsert on `paper_id`); see both peer reports on assigned papers. [C]
- **Cannot:** shortlist a paper they submitted (conflict); act outside assigned papers; make the final editorial decision; manage volumes. [C]
- **Role definition (Role Key):** "Shortlist + grade assigned papers." [C]

### 5.3 Desk Reviewer
- **Nav:** Dashboard · Papers · Activity (no Volumes/Archive). [C]
- **Can:** open assigned paper; **record Turnitin results** (Similarity %, AI-Writing %, similarity report URL, AI report URL, notes); set **Pass → Phase 3** or **Fail**. Workflow helper: copy Drive link → open Turnitin → paste results. [C]
- **Cannot:** see peer-review reports or the editor's decision ("Hidden from reviewers…"); assign reviewers; accept/reject/finalise; manage volumes. [C]
- **Role definition:** "Desk-check assigned papers." [C]

### 5.4 Peer Reviewer (R1 / R2)
- **Nav:** Dashboard · Papers · Activity. [C]
- **Review form:** Decision **Accept / Revise / Reject** + single **Comments** textarea + optional **"Revision received link"**. **No numeric score, no rubric, no annotated-file upload** in the prototype. Manuscript opened via Drive link. [C]
- **Cannot:** see the desk review, the *other* reviewer's report, or the editor's decision; review a paper they submitted; open unassigned papers (dedicated "You don't have access to this paper" screen). [C]
- **Business rule:** both R1 and R2 "Accept" required to reach "Ready for Volumes". [C]
- **Role definition:** "Review assigned papers (R1 / R2)." [C]

### 5.5 Editor
- **Nav:** Dashboard · Papers · **Volumes** · **Archive** · Activity. [C]
- **Can:** see full paper (metadata, reviewer assignments, desk results, **both** peer reports, final decision); set final decision **Accept / Request revision / Reject**; assemble **Volumes** (create, "Fill smartly" auto-fill with ≤10, set Cover, **Lock**, manage "Publications recipients", **send for publishing**); manage **Archive** (Download PDF, Restore). [C]
- **Scope:** only papers assigned to them as Editor ("Showing only papers assigned to you as Editor … Contact the Administrator if a paper is missing"). [C]
- **Role definition:** "Final decision + volume." [C]

### 5.6 Admin
- **Nav:** Dashboard · Papers · Import · Volumes · Archive · **Users** · Activity. [C]
- **Can:** everything on every paper and person; **People & roles** management ("+ Add person", Manage, per-paper **Assign role** with live conflict check and a visibility panel "N/11 people can open this paper"); create/import papers; see open-role-slot alerts ("2 papers have an open role slot — CD2 needs Peer Reviewer R2 …"); per-school analytics dashboards with deep programme/batch filters. [C]
- **Role definition:** "Every paper, every person." [C]

---

## 6. Role × capability matrix (confirmed)

| Capability | Submitter | SPOC | Desk Rev. | Peer Rev. | Editor | Admin |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| Register / sign in | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Submit / create own paper | ✓ | ✓¹ | ✓¹ | ✓¹ | ✓¹ | ✓ |
| Edit own paper (Drive link, themes) until shortlist | ✓ | – | – | – | – | ✓ |
| See only own papers | ✓ | – | – | – | – | – |
| See assigned papers only | – | ✓ | ✓ | ✓ | ✓ | n/a (all) |
| Phase-1 shortlist + set grade | – | ✓ | – | – | – | ✓ |
| Assign Desk/Peer reviewers | – | ✓ | – | – | – | ✓ |
| Assign SPOC/Editor roles | – | – | – | – | – | ✓ |
| Record Turnitin / desk Pass·Fail | – | – | ✓ | – | – | ✓ |
| Submit peer decision (R1/R2) | – | – | – | ✓ | – | ✓ |
| See other reviewer's report | – | ✓ | – | ✗ | ✓ | ✓ |
| See desk review | – | ✓ | ✓ (own) | ✗ | ✓ | ✓ |
| Final decision (Accept/Revise/Reject) | – | – | – | – | ✓ | ✓ |
| Manage volumes / archive | – | – | – | – | ✓ | ✓ |
| Bulk import (CSV/Excel) | – | ✓ | – | – | – | ✓ |
| Manage people & roles | – | – | – | – | – | ✓ |

¹ As a Submitter on a *different* paper — never on a paper where they hold a review/grade/edit role (conflict block).

---

## 7. Status & stage vocabulary (confirmed)

- **Paper phase chips:** P1 (SPOC Shortlist) · P2 Desk · P3 Peer R1 · P4 Peer R2 · P5 Volumes. [C]
- **Paper status:** `pending`, `accepted`, `rejected` (implied), `None`/undecided. [C]
- **Desk status:** `PENDING`, `PASS`, `FAIL`. [C]
- **Peer decision:** `ACCEPT`, `REVISE`, `REJECT`. [C]
- **Volume state:** `Ready`, `Placed`, `Locked`, `Archived`. [C]
- **Activity badge types:** `ROLE`, `INFO`, `DECISION`, `ASSIGNMENT`. [C]

---

## 8. Confirmed external integrations (prototype) → production stance

| Area | Prototype (seen) | Production recommendation |
|---|---|---|
| Manuscript file | **Google Drive link** field + "Open ↗" | Keep Drive link as an option, but add **private object storage** (S3-compatible) with virus scan + signed, time-limited download URLs; store only metadata/reference in DB. [P] |
| Plagiarism / AI | **Turnitin** (manual: paste Similarity %, AI %, report URLs) | Keep manual capture for MVP; evaluate Turnitin API later. [P] |
| Email | **MOCKED** ("add a Resend/SendGrid key to activate") | Wire **Resend or SendGrid**; notifications already modelled as an activity feed. [P] |
| Import | CSV/Excel upsert on `paper_id`; 16 columns incl. `desk_reviewer,peer_r1,peer_r2,editor` | Server-side validation, dry-run preview, audit of every upsert. [P] |

See `system-architecture-summary.md` for the recommended stack and `open-questions-and-assumptions.md` for every decision still needing sign-off.
