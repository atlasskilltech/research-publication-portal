// External AUTHOR registration — AIDC – ATLAS International Design Conference 2026.
//
// PURE (no I/O, no framework imports): the same validation runs in the browser
// (app/(auth)/register) and on the server (/api/register/author), and the
// orchestration is unit-tested offline (scripts/test-author-registration.mjs).
//
// Flow (Google-first, two phase — no account exists until Google proves the email):
//   1. The form posts here. Valid + email not already registered → a PENDING
//      registration row (form data + SHA-256 of a random token, 30 min expiry).
//      The raw token goes ONLY into an httpOnly cookie bound to this browser.
//   2. "Continue with Google" starts the existing OIDC flow with that pending
//      registration linked to the single-use OAuth state.
//   3. The callback (lib/oauthPolicy.completeGoogleCallback) requires a verified
//      Google email that EXACTLY equals the registered email, then creates the
//      AUTHOR account + profile, links the Google identity, signs the user in
//      and sends ONE confirmation email.
// Nothing here reads a role, admin flag or user id from the request.

export const CONFERENCE_CODE = "AIDC_2026";
export const CONFERENCE_NAME = "AIDC – ATLAS International Design Conference 2026";
export const CONFERENCE_SHORT = "AIDC 2026";

export const AUTHOR_COOKIE = "rpp_author_reg";
export const AUTHOR_REGISTRATION_TTL_SECONDS = 30 * 60;

/** Current status options (value stored in MySQL → label shown). */
export const AUTHOR_STATUSES = Object.freeze([
  { value: "WORKING_PROFESSIONAL", label: "Working Professional" },
  { value: "STUDENT", label: "Student" },
  { value: "RESEARCHER", label: "Researcher" },
  { value: "INDEPENDENT_RESEARCHER", label: "Independent Researcher" },
  { value: "OTHER", label: "Other" },
]);
export const AUTHOR_STATUS_VALUES = Object.freeze(AUTHOR_STATUSES.map((s) => s.value));
export const authorStatusLabel = (v) => AUTHOR_STATUSES.find((s) => s.value === v)?.label || "—";

export const AUTHOR_REGISTERED_MESSAGE =
  "Almost done. Continue with Google using the same email address to activate your Author account.";
export const AUTHOR_EXISTS_MESSAGE =
  "An account with this email already exists. Sign in instead.";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Printable text only: no control characters (incl. newlines) in single-line fields.
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

const str = (v) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

/** Phone: digits with optional leading +, spaces, dashes, dots, parentheses; 7–15 digits (E.164 max). */
export function normalizePhone(v) {
  return str(v);
}
export function isValidPhone(v) {
  const s = normalizePhone(v);
  if (!s || s.length > 32) return false;
  if (!/^\+?[0-9][0-9 ()\-.]*[0-9)]$/.test(s)) return false;
  const digits = s.replace(/\D/g, "").length;
  return digits >= 7 && digits <= 15;
}

export function isValidEmail(email) {
  const e = String(email || "");
  return e.length <= 191 && EMAIL_RE.test(e) && e.indexOf("@") === e.lastIndexOf("@") && !CONTROL_RE.test(e);
}

const textField = (v, min, max) => {
  const s = str(v);
  return s.length >= min && s.length <= max && !CONTROL_RE.test(s);
};

/**
 * Validate + normalise the Author form. Every field is REQUIRED.
 * → { ok: true, data: { name, email, phone, organization, currentStatus, designation, location } }
 *   | { ok: false, fields: { <field>: message } }
 */
export function validateAuthorRegistration(body) {
  const data = {
    name: str(body?.name),
    email: str(body?.email).toLowerCase(),
    phone: normalizePhone(body?.phone),
    organization: str(body?.organization),
    currentStatus: str(body?.currentStatus).toUpperCase(),
    designation: str(body?.designation),
    location: str(body?.location),
  };
  const fields = {};
  if (!textField(data.name, 2, 120)) fields.name = "Enter your full name.";
  if (!data.email) fields.email = "Enter your email address.";
  else if (!isValidEmail(data.email)) fields.email = "Enter a valid email address.";
  if (!data.phone) fields.phone = "Enter your phone number.";
  else if (!isValidPhone(data.phone)) fields.phone = "Enter a valid phone number (7–15 digits, optional + country code).";
  if (!textField(data.organization, 2, 200)) fields.organization = "Enter your organization or institution name.";
  if (!AUTHOR_STATUS_VALUES.includes(data.currentStatus)) fields.currentStatus = "Choose your current status.";
  if (!textField(data.designation, 2, 200)) fields.designation = "Enter your designation, job role, course or area of study.";
  if (!textField(data.location, 2, 200)) fields.location = "Enter where your organization or institution is located.";
  if (Object.keys(fields).length) return { ok: false, fields };
  return { ok: true, data };
}

/**
 * Phase 1 — store the pending registration (no account yet).
 * deps:
 *   findUserByEmail(email)   → row | null
 *   createPending(data)      → { token }  (raw token for the httpOnly cookie)
 * → { status, body, token? }
 */
export async function registerAuthor(data, deps) {
  if (await deps.findUserByEmail(data.email)) {
    return { status: 409, body: { error: AUTHOR_EXISTS_MESSAGE, code: "exists", issues: { email: AUTHOR_EXISTS_MESSAGE } } };
  }
  const { token } = await deps.createPending(data);
  return {
    status: 201,
    token,
    body: { ok: true, pending: true, email: data.email, message: AUTHOR_REGISTERED_MESSAGE },
  };
}
