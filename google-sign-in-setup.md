# Google Sign-In: setup and security notes

**Status (2026-11-04):** implemented directly against Google's OpenID Connect,
with no Supabase or any other auth service. It is tested locally with real
RS256 signatures and against a running build, but it is **not yet configured
with a real Google OAuth client**. Nothing has been committed or deployed.

## Google-first registration (current behaviour)

- **Registration** (student or faculty) creates the account with no password and
  no setup link. Students still need a unique, verified application number.
  The account category comes from the registration form; no roles are assigned.
- **One email** is sent: "Your Research Portal Registration Is Complete", telling
  the user to sign in with their ATLAS University Google account. It contains no
  token. If delivery fails, the registration still succeeds.
- **Sign-in** is Google first. Only verified `@atlasuniversity.edu.in` identities
  that match an existing account get in. Google never creates accounts and never
  changes roles. The first Google sign-in marks the email verified.
- **Optional password:** a signed-in user without a password can add one from
  **Account settings** (`/account`, API `POST /api/account/password`). It is
  hashed with Argon2id, never overwrites an existing password, keeps the current
  session and signs out other devices.
- **Forgot password** still emails a single-use reset link. It is also how an
  approved non-university address (which can't use Google) creates a password.
- Setup links emailed before this change still work.

Tests: `npm run test:google-first` (offline) and
`node scripts/test-google-first-http.mjs http://localhost:3001` (running app).

## Redirect URI to register in Google Cloud

```
https://research.atlasskilltech.app/auth/callback
```

For local testing, also register `http://localhost:3001/auth/callback` (or
whichever port you run on). Do **not** use any `*.supabase.co` callback.

## How it works

```
/login ──POST /auth/google──▶ accounts.google.com (code + PKCE S256, state, nonce, hd hint)
       ──▶ GET /auth/callback?code&state
             1. state == browser cookie (rpp_oauth_state, httpOnly, 10 min)
                AND state row exists in MySQL (hashed; deleted on read → single use)
             2. code → tokens at oauth2.googleapis.com (client secret + PKCE verifier, server-side)
             3. ID token: RS256 signature (Google JWKS), iss, aud, azp, exp, iat,
                nonce (bound to this state), email_verified === true,
                email exactly @atlasuniversity.edu.in, Workspace hd claim = same domain
             4. match an EXISTING account: linked Google `sub`, else exact email
                (first use links the sub; an account already linked to a
                different Google account is refused)
             ├─ ok       → APP session (MySQL), /dashboard or the safe callbackUrl
             └─ rejected → /login?notice=google_* (no session, no account, no role)
```

The rules live in `lib/oauthPolicy.js`, which is pure and unit-tested. The server
side (state rows, token exchange, JWKS, identity linking) is in
`lib/googleAuth.js`. The routes are `app/auth/google/route.js` and
`app/auth/callback/route.js`.

- **Google never creates accounts and never changes roles or the admin flag.**
  New users register through `/register` (Application Number check and email
  verification) first, and can then use Google.
- An account that registered but never clicked its verification link is allowed
  in, and is marked verified, because Google has proved the user owns the email.
- `prompt=select_account` and `hd=atlasuniversity.edu.in` are hints for Google's
  account chooser. The domain is enforced only on the verified token.
- Identities are stored in `research_user_identities`, with
  `(provider, subject)` unique and one Google identity per account.

## Manual configuration (your action)

### A. Google Cloud Console

1. Open https://console.cloud.google.com and select (or create) a project,
   preferably **inside the atlasuniversity.edu.in Google Workspace organisation**.
2. **Google Auth Platform → Branding:** set the app name to "Research Publication
   Portal" and a support email. Add `atlasskilltech.app` as an authorised
   domain.
3. **Audience → User type: Internal** (recommended; only possible inside the
   Workspace organisation). Google then admits only Workspace accounts at
   consent. The portal enforces the domain itself either way.
4. **Data access → scopes:** `openid`, `.../auth/userinfo.email` and
   `.../auth/userinfo.profile`, nothing else.
5. **Clients → Create client → Web application:**
   - **Authorised redirect URIs:** `https://research.atlasskilltech.app/auth/callback`
     (and `http://localhost:3001/auth/callback` for local testing).
   - Authorised JavaScript origins are not needed, because the flow is entirely
     server-side.
6. Copy the **Client ID** and **Client Secret**.

### B. Server `.env` on Ubuntu (server-only, never `NEXT_PUBLIC_`)

```env
GOOGLE_CLIENT_ID=<client id>.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<client secret>
GOOGLE_REDIRECT_URI=https://research.atlasskilltech.app/auth/callback
```

Restart the app (`pm2 reload <app>`). If any of the three variables is missing or
invalid, Google Sign-In reports "temporarily unavailable" and email/password login
keeps working.

## Manual end-to-end checklist (after A and B)

1. A registered `@atlasuniversity.edu.in` user lands on `/dashboard`. Check that
   `research_user_identities` gains one row.
2. An existing administrator can open `/users`, and their roles are unchanged.
3. A personal `@gmail.com` account sees "Please sign in using your ATLAS
   University email account." and no session is created.
4. An unregistered `@atlasuniversity.edu.in` account sees "Register first…" and no
   account is created.
5. Press Back from the Google chooser: the button must not stay stuck on loading.

## Tests

| Suite | What it covers |
|---|---|
| `npm run test:google-auth` | Offline, with real RS256 tokens. Covers the 9 required cases (verified, unverified, gmail, outlook, lookalike domain, upper-case, existing admin, unauthorised access, invalid/expired/replayed state), plus algorithm confusion, tampering, wrong audience/issuer, nonce, `hd`, PKCE and open redirects. |
| `npm run test:google-auth-http -- http://localhost:3001` | Against a running build: PKCE start, the stored state row, every callback rejection, replay, and forged sessions. |
