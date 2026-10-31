// Branded transactional email templates (pure). Every builder returns
// { subject, html, text }: table-based, inline-CSS HTML for email clients plus a
// real plain-text alternative. All interpolated values are HTML-escaped; links
// are passed in already built by the server (never derived from user input).
//
// Brand: ATLAS SkillTech University · Research Publication Portal — colours from
// app/globals.css (--color-brand #2e2a6b, --color-accent #e91e8c, --color-ink,
// --color-muted, --color-line, --color-soft) and the existing app/apple-icon.png.

const C = { brand: "#2e2a6b", brandLight: "#403b8f", accent: "#e91e8c", ink: "#1f2335", muted: "#5b6176", line: "#e3e6f0", soft: "#f5f6fb", brand50: "#eef0f8", onBrand: "#c9c7ee" };
const FONT = "Arial,Helvetica,sans-serif";

export function escapeHtml(v) {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * Shared layout.
 * opts: { siteUrl, preheader, heading, paragraphs[], cta?{label,url}, afterCta?[], notice?{title,text}, footerNote }
 */
export function renderLayout({ siteUrl, preheader, heading, paragraphs = [], cta, afterCta = [], notice, footerNote }) {
  const e = escapeHtml;
  const logo = siteUrl ? `${String(siteUrl).replace(/\/+$/, "")}/apple-icon.png` : null;
  const p = (t, color = C.ink, size = 15) => `<p style="margin:0 0 16px 0;font-family:${FONT};font-size:${size}px;line-height:1.6;color:${color};">${e(t)}</p>`;

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="x-apple-disable-message-reformatting"><title>${e(heading)}</title></head>
<body style="margin:0;padding:0;background-color:${C.soft};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${e(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${C.soft};"><tr><td align="center" style="padding:32px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background-color:#ffffff;border:1px solid ${C.line};border-radius:14px;">
<tr><td style="background-color:${C.brand};padding:24px 32px;border-radius:14px 14px 0 0;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
${logo ? `<td style="vertical-align:middle;padding-right:12px;"><img src="${e(logo)}" width="40" height="40" alt="ATLAS" style="display:block;border:0;border-radius:8px;"></td>` : ""}
<td style="vertical-align:middle;font-family:${FONT};"><div style="font-size:16px;font-weight:bold;color:#ffffff;line-height:1.3;">Research Publication Portal</div><div style="font-size:12px;color:${C.onBrand};line-height:1.4;">ATLAS SkillTech University</div></td>
</tr></table></td></tr>
<tr><td style="height:4px;background-color:${C.accent};line-height:4px;font-size:0;">&nbsp;</td></tr>
<tr><td style="padding:36px 32px 8px 32px;">
<h1 style="margin:0 0 16px 0;font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.25;color:${C.ink};font-weight:bold;">${e(heading)}</h1>
${paragraphs.map((t) => p(t)).join("\n")}
</td></tr>
${cta ? `<tr><td style="padding:8px 32px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="${C.brand}" style="border-radius:8px;">
<a href="${e(cta.url)}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:8px;background-color:${C.brand};">${e(cta.label)}</a>
</td></tr></table></td></tr>
<tr><td style="padding:16px 32px 0 32px;">
${afterCta.map((t) => p(t, C.muted, 14)).join("\n")}
<p style="margin:0 0 6px 0;font-family:${FONT};font-size:13px;line-height:1.5;color:${C.muted};">If the button doesn't work, copy and paste this link into your browser:</p>
<p style="margin:0 0 24px 0;font-family:${FONT};font-size:12px;line-height:1.5;word-break:break-all;"><a href="${e(cta.url)}" style="color:${C.brandLight};">${e(cta.url)}</a></p>
</td></tr>` : afterCta.length ? `<tr><td style="padding:0 32px;">${afterCta.map((t) => p(t, C.muted, 14)).join("\n")}</td></tr>` : ""}
${notice ? `<tr><td style="padding:0 32px 32px 32px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${C.brand50};border-radius:8px;"><tr><td style="padding:14px 16px;font-family:${FONT};font-size:13px;line-height:1.55;color:${C.ink};"><strong>${e(notice.title)}</strong> ${e(notice.text)}</td></tr></table></td></tr>` : ""}
<tr><td style="padding:20px 32px;border-top:1px solid ${C.line};font-family:${FONT};font-size:12px;line-height:1.6;color:${C.muted};">
<strong style="color:${C.brand};">ATLAS SkillTech University</strong> &middot; Research Publication Portal<br>${e(footerNote || "This is an automated message. Please do not reply.")}
</td></tr>
</table></td></tr></table>
</body></html>`;

  const text = [
    "Research Publication Portal — ATLAS SkillTech University",
    "",
    heading,
    "",
    ...paragraphs.flatMap((t) => [t, ""]),
    ...(cta ? [`${cta.label}:`, cta.url, ""] : []),
    ...afterCta.flatMap((t) => [t, ""]),
    ...(notice ? [`${notice.title} ${notice.text}`, ""] : []),
    "--",
    "ATLAS SkillTech University · Research Publication Portal",
    footerNote || "This is an automated message. Please do not reply.",
  ].join("\n");

  return { html, text };
}

const ONCE = "This secure link is intended only for your account and can be used once before it expires. If it has expired, request a new email from the portal's sign-in page.";
const NEVER_SHARE = "Never share this link with anyone; ATLAS staff will never ask for your password.";

/** Registration: account invitation / verification + create password. */
export function inviteEmail({ siteUrl, link }) {
  return {
    subject: "Complete Your Research Portal Registration",
    ...renderLayout({
      siteUrl,
      preheader: "Activate your ATLAS Research Publication Portal account by creating a secure password.",
      heading: "Welcome to the Research Publication Portal",
      paragraphs: ["Your registration has been received successfully. To activate your account, create a secure password using the button below."],
      cta: { label: "Create Your Password", url: link },
      afterCta: [ONCE],
      notice: { title: "Didn't register?", text: `If you did not create an account on the ATLAS Research Publication Portal, you can safely ignore this email. No account will be activated without this link. ${NEVER_SHARE}` },
      footerNote: "You are receiving this because a portal registration was started with this address. Please do not reply.",
    }),
  };
}

/** Verified account that still needs a password (resend after verification). */
export function setupEmail({ siteUrl, link }) {
  return {
    subject: "Create Your Research Portal Password",
    ...renderLayout({
      siteUrl,
      preheader: "Finish setting up your ATLAS Research Publication Portal account.",
      heading: "Create your portal password",
      paragraphs: ["Your email address is verified. Use the button below to create the password for your Research Publication Portal account."],
      cta: { label: "Create Your Password", url: link },
      afterCta: [ONCE],
      notice: { title: "Didn't ask for this?", text: `You can safely ignore this email; nothing changes unless the link is used. ${NEVER_SHARE}` },
    }),
  };
}

/** Forgot password. */
export function resetEmail({ siteUrl, link }) {
  return {
    subject: "Reset Your Research Portal Password",
    ...renderLayout({
      siteUrl,
      preheader: "Use this secure link to reset your Research Publication Portal password.",
      heading: "Reset your password",
      paragraphs: ["We received a request to reset the password for your Research Publication Portal account. Use the button below to choose a new password."],
      cta: { label: "Reset Your Password", url: link },
      afterCta: [ONCE],
      notice: { title: "Didn't request a reset?", text: `You can safely ignore this email: your current password stays unchanged. ${NEVER_SHARE}` },
    }),
  };
}

/** After a password is created or changed. No link to any account action. */
export function passwordChangedEmail({ siteUrl, loginUrl, firstTime = false }) {
  return {
    subject: firstTime ? "Your Research Portal Account Is Ready" : "Your Research Portal Password Was Changed",
    ...renderLayout({
      siteUrl,
      preheader: firstTime ? "Your password has been created." : "Your password was just changed.",
      heading: firstTime ? "Your account is ready" : "Your password was changed",
      paragraphs: [firstTime
        ? "Your password has been created and your Research Publication Portal account is active. You can now sign in with your registered email address and new password."
        : "The password for your Research Publication Portal account was just changed. You can sign in with your new password."],
      cta: loginUrl ? { label: "Sign In", url: loginUrl } : undefined,
      notice: { title: "Wasn't you?", text: "If you did not make this change, reset your password immediately from the sign-in page and contact the portal administrator." },
    }),
  };
}

/**
 * Prepared structure for FUTURE editorial notifications (decision available,
 * revision requested, publication). Not sent anywhere yet.
 */
export function editorialNotificationEmail({ siteUrl, subject, heading, paragraphs, cta, footerNote }) {
  return { subject, ...renderLayout({ siteUrl, preheader: paragraphs?.[0] || heading, heading, paragraphs, cta, footerNote }) };
}
