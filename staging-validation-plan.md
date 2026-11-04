# Validation plan (MySQL)

The portal runs on MySQL only. Validate on a **non-production** database first:
a local MySQL/MariaDB, or a copy of production restored from a backup. Never
create test users or papers in the production database.

## 1. Offline and unit suites (no server)

```
npm run test:auth-flow
npm run test:google-auth
npm run test:admin-guards
npm run test:manuscript-files
npm run test:review-logic
npm run test:review-access
npm run test:revision-logic
npm run test:decision-logic
npm run test:publication-logic
npm run test:dashboard-logic
npm run test:audit-fixes
npm run test:email-service
npm run test:notifications
```

## 2. Database suite (real MySQL, throwaway database)

```
IT_DB_HOST=localhost IT_DB_USER=root IT_DB_PASSWORD= npm run test:mysql
```

This suite creates `rpp_it_<random>`, applies `database/migrations/*`, and
exercises:
- UTC, strict mode and InnoDB;
- Argon2id and the bcrypt upgrade path;
- sessions: expiry, idle timeout, revocation, purpose and account status;
- single-use tokens, including the concurrent case;
- role guards, including concurrent demotion and the last-admin rule;
- cascades;
- the full submit → review → decision → revision → re-review → accept →
  publish state machine, with every guard and race.

It then drops the database. It refuses non-local hosts unless
`RPP_IT_ALLOW_REMOTE=yes`.

## 3. Rehearse the real migration on a copy

1. Restore a production backup into a scratch database.
2. With `DB_NAME` pointing at that scratch database, run `npm run db:check`,
   then `npm run db:migrate -- --apply`, then
   `npm run db:import-supabase-export -- <export.json>` (dry run first, then
   `--apply`).
3. Run `npm run db:check` again and confirm the accounts and roles.

## 4. HTTP suites against a running build

Build and start on the scratch database. Disable SMTP for test runs
(`SMTP_HOST=127.0.0.1 SMTP_PORT=9`) so no test email reaches a real mailbox.
Set placeholder `GOOGLE_*` values to exercise the Google start and callback
paths, and set `MANUSCRIPT_STORAGE_DIR` to a scratch directory. Then:

```
node scripts/test-http-guards.mjs http://localhost:3001
node scripts/test-auth-http.mjs http://localhost:3001
node scripts/test-auth-live-app.mjs http://localhost:3001
node scripts/test-register-form.mjs http://localhost:3001
node scripts/test-registration.mjs http://localhost:3001
node scripts/test-admin-http.mjs http://localhost:3001
node scripts/test-email-policy.mjs http://localhost:3001
node scripts/test-google-auth-http.mjs http://localhost:3001
node scripts/test-e2e-live.mjs http://localhost:3001
```

All of them create their own throwaway accounts and remove them afterwards.

## 5. Production

Follow `mysql-migration-guide.md` §6: inspect, back up, migrate, import,
configure the environment, and switch over.
