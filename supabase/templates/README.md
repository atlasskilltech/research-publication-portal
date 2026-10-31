# Auth email templates — NOT USED in the current architecture

**Current architecture: application-managed delivery (Resend).**
Supabase creates accounts and generates one-time tokens with
`auth.admin.generateLink()` — which sends **no** email — and the portal builds the
`/auth/confirm?token_hash=…&type=…&flow=…` link and delivers it through Resend
(`lib/authMailer.js`, `lib/email/templates.js`, `lib/email/resend.js`).
Supabase still validates the token (`verifyOtp`), owns sessions and passwords.

So the Supabase Dashboard email templates and Supabase SMTP are **not involved**
in registration, setup, reset or password-changed emails. Do **not** also
configure Supabase to send these (that would be a second sender). Leave the
dashboard templates as they are.

The files here (`invite.html`, `recovery.html`, `invite.txt`) and
`scripts/supabase-apply-email-templates.mjs` are kept only as a fallback for the
alternative architecture (Resend as Supabase custom SMTP). They are not needed.

Why the original `link_invalid` happened: the old flow used Supabase's default
`{{ .ConfirmationURL }}`; for admin invites (implicit flow) Supabase verifies the
token itself and returns the session in a URL fragment (`#access_token=…`) that
the server never sees.
