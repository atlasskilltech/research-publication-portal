# Legacy Supabase artefacts (historical reference only)

The portal no longer uses Supabase (migrated to MySQL on 2026-11-04 — see
`../../mysql-migration-guide.md`). These Postgres migrations and email templates
are kept ONLY as a record of the previous schema/rules; they are not part of any
active workflow and nothing reads them. The MySQL schema lives in
`database/migrations/`, the workflow rules in `lib/services/workflow.mjs`.
