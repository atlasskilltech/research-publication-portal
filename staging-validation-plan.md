# Staging validation plan

Production Supabase currently has migrations 0001–0004 and 0010. Everything after
registration (submissions, reviews, revisions, decisions, publications) needs
0005–0009 and 0011, which are **not applied**. Do the steps below on a
**separate staging Supabase project** first — never create test users or papers
in the shared production project.

## 1. Verify locally (no network)

```
npm i --no-save @electric-sql/pglite@0.5.8
npm run test:workflow-sql      # all 11 migrations, production order, full workflow under RLS
npm run test:admin-roles-sql   # 0010 escalation fix
```

## 2. Create the staging project

1. New Supabase project (same region). Note its URL, publishable key, secret key.
2. A copy of `.env.local` pointing at staging (e.g. `.env.staging`), with
   `NEXT_PUBLIC_SITE_URL` set to the staging app URL and the Resend variables
   (`RESEND_API_KEY`, `EMAIL_FROM` on a verified domain, `EMAIL_FROM_NAME`).
3. Apply every migration to the **empty** staging project (this is the only
   place `--all` is acceptable):
   `node --env-file=.env.staging scripts/supabase-apply-migrations.mjs --all`
4. Auth settings and admins — run the scripts with `node --env-file=.env.staging`
   directly. **Do not use `npm run …` here: the npm scripts load `.env.local`,
   which points at production.**
   ```
   node --env-file=.env.staging scripts/supabase-auth-config.mjs
   node --env-file=.env.staging scripts/supabase-apply-email-templates.mjs
   node --env-file=.env.staging scripts/provision-supabase-admins.mjs
   ```
5. Run the app against staging from a **separate copy of the project** whose
   `.env.local` contains the staging values (safest — nothing can fall back to
   production). Before testing, confirm `/api/health` reports the staging project ref.

## 3. Manual end-to-end run (staging)

Use real mailboxes you control. Tick each step.

| # | Step | Who | Expect |
|---|------|-----|--------|
| 1 | Register | author | invite email arrives (Resend) |
| 2 | Open link, create password, log in/out | author | dashboard loads |
| 3 | Forgot password → reset; reuse old link | author | reset works; reused/expired link rejected |
| 4 | Grant PEER_REVIEWER ×2, EDITOR | admin | People & roles updates |
| 5 | Submit paper (PDF, 2 authors) | author | "Submission Received" email |
| 6 | Assign 2 reviewers + editor with deadline | admin | status UNDER_REVIEW; assignment emails |
| 7 | Reviewer opens paper | reviewer | no author names; manuscript downloads |
| 8 | Both reviewers submit (with confidential note) | reviewers | editor gets "Review Submitted" |
| 9 | Editor saves + communicates MAJOR revision, releasing one review | editor | author email; author sees "Reviewer 1" comments only, no confidential note |
| 10 | Author uploads v1, answers points, submits | author | editor gets "Revision Submitted" |
| 11 | Editor releases re-review | editor | reviewers emailed; v1 visible to them |
| 12 | Reviewer submits round-1 review; editor ACCEPTs | — | author email; status ACCEPTED |
| 13 | Create volume + issue; schedule paper | admin/editor | publication SCHEDULED |
| 14 | Publish volume, then issue (with papers) | admin | author "Published" email |
| 15 | Open `/publications` logged out | public | paper listed; download only if made public |
| 16 | Activity + dashboards per role | all | authors never see reviewer identity |

## 4. Production rollout (after staging passes)

1. Take a database backup (Supabase dashboard → Database → Backups).
2. Dry run, then apply ONLY the pending set — never without a filter:
   ```
   node scripts/supabase-apply-migrations.mjs 0005 0006 0007 0008 0009 0011 --dry-run
   node scripts/supabase-apply-migrations.mjs 0005 0006 0007 0008 0009 0011
   ```
   Each file is a separate call: if one fails, stop and fix — earlier files stay applied
   (all are idempotent, so re-running the same set is safe).
3. Never re-apply 0004: it replaces the 0010-hardened `admin_set_user_roles`
   with the vulnerable version (`test:workflow-sql` demonstrates this).
4. Re-run the 0010 verification query (in the 0010 file header).
5. Deploy the app, then repeat steps 5–15 once with a real paper.
