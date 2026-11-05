# Email setup (SendGrid)

The portal sends every email through one configurable provider
(`lib/email/config.js` → `lib/email/send.js`). Production uses **SendGrid**
through the official `@sendgrid/mail` SDK. SMTP and Resend remain available by
changing `EMAIL_PROVIDER`; templates and notification events don't change.

## Server `.env`

```env
EMAIL_PROVIDER=sendgrid
SENDGRID_API_KEY=<your SendGrid API key>   # never commit this
EMAIL_FROM=elizabeth.jerome@atlasuniversity.edu.in
EMAIL_FROM_NAME=Elizabeth Jerome
EMAIL_REPLY_TO=                              # optional
```

Then restart so the new values are loaded:

```bash
pm2 reload research-publication-portal --update-env
```

At startup the server logs one line: `email: configured {...}` or
`email: not configured {... "reason": ...}`. The key is never logged.

## SendGrid must trust the sender (required before any email is delivered)

SendGrid refuses mail whose From address it hasn't verified. Do **one** of:

- **Single Sender Verification:** SendGrid → Settings → Sender Authentication →
  Verify a Single Sender → `elizabeth.jerome@atlasuniversity.edu.in`, then click
  the link SendGrid emails to that mailbox.
- **Domain Authentication (recommended):** SendGrid → Settings → Sender
  Authentication → Authenticate Your Domain → `atlasuniversity.edu.in`. Add the
  CNAME records SendGrid shows to the domain's DNS. This improves deliverability
  (SPF/DKIM) and lets any address on the domain send.

The API key needs at least the **Mail Send** permission.

If the sender isn't verified, sends fail with `code: "config"` and the log shows
`provider: "invalid_from_address"` or `"invalid_access"`. The rest of the portal
keeps working.

## Check it on the server

```bash
npm run email:check
```

This validates the configuration and sends nothing.

```bash
npm run email:check -- --to your.address@atlasuniversity.edu.in
```

This sends ONE real test email. "Accepted" means SendGrid took the message;
confirm it actually arrived (check spam too) before treating email as working.

## Emails the portal sends

- **Account emails:** registration confirmation, sign-in instructions (Resend),
  password reset, password added, and password changed.
- **Workflow emails:** submission received, reviewer assigned, editor assigned,
  review submitted, decision available (which covers revision requests),
  revision submitted, re-review requested, and paper published.

Click and open tracking are turned off, so links such as password-reset links
are never rewritten.
