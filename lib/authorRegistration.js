// External AUTHOR registration — AIDC – ATLAS International Design Conference 2026.
//
// PURE (no I/O, no framework imports): the same validation runs in the browser
// (app/(auth)/register) and on the server (/api/register/author), and the
// orchestration is unit-tested offline (scripts/test-author-registration.mjs).
//
// Authors use EMAIL + PASSWORD only (no Google):
//   1. The form (7 profile fields + password + confirm) posts to
//      /api/register/author. Valid + email not already registered → the AUTHOR
//      account (Argon2id password hash, never plaintext) and its profile are
//      created in one transaction, the user is signed in with the existing
//      session system, and ONE confirmation email is sent (SendGrid).
//   2. Returning Authors sign in with email + password on /login; "Forgot
//      password" works for them. Google Sign-In refuses AUTHOR accounts.
// Nothing here reads a role, admin flag or user id from the request.

import { validatePasswordPair } from "./passwordPolicy.js";

export const CONFERENCE_CODE = "AIDC_2026";
export const CONFERENCE_NAME = "AIDC – ATLAS International Design Conference 2026";
export const CONFERENCE_SHORT = "AIDC 2026";

// Pending-registration cookie of the earlier Google-based flow. No longer set;
// kept only so a stale cookie can be cleared.
export const AUTHOR_COOKIE = "rpp_author_reg";

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
  "Your Author account has been created and you are signed in. Next time, sign in with your email address and password.";
export const AUTHOR_EXISTS_MESSAGE =
  "An account with this email already exists. Sign in instead, or use \"Forgot password\" to set a password.";

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
 * Validate + normalise the Author form. Every field is REQUIRED, including
 * password + confirmPassword (shared policy: 10–200 characters, must match).
 * The password is returned separately and never part of `data`.
 * → { ok: true, data: { name, email, phone, organization, currentStatus, designation, location }, password }
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
  const password = typeof body?.password === "string" ? body.password : "";
  const confirmPassword = typeof body?.confirmPassword === "string" ? body.confirmPassword : "";
  if (!password) fields.password = "Choose a password.";
  else if (!confirmPassword) fields.confirmPassword = "Confirm your password.";
  else {
    const pw = validatePasswordPair(password, confirmPassword);
    if (!pw.ok) fields[pw.field === "confirm" ? "confirmPassword" : "password"] = pw.error;
  }
  if (Object.keys(fields).length) return { ok: false, fields };
  return { ok: true, data, password };
}

/**
 * Create the AUTHOR account (one step — no Google, no pending state).
 * deps:
 *   findUserByEmail(email)                 → row | null
 *   createAuthor({ data, password })       → userId  (hashes the password with
 *                                            Argon2id; account + profile in one
 *                                            transaction; throws { duplicate: true }
 *                                            on a unique-key race)
 *   startSession(userId)                   → void (existing session system)
 *   sendConfirmation({ userId, email, name }) → { ok }  (best-effort)
 * → { status, body }
 */
export async function registerAuthor(data, password, deps) {
  const conflict = { status: 409, body: { error: AUTHOR_EXISTS_MESSAGE, code: "exists", issues: { email: AUTHOR_EXISTS_MESSAGE } } };
  if (await deps.findUserByEmail(data.email)) return conflict;
  let userId;
  try {
    userId = await deps.createAuthor({ data, password });
  } catch (e) {
    if (e?.duplicate) return conflict;
    throw e;
  }
  await deps.startSession(userId);
  let emailSent = false;
  try {
    emailSent = !!(await deps.sendConfirmation({ userId, email: data.email, name: data.name }))?.ok;
  } catch {
    emailSent = false; // never fails the registration
  }
  return { status: 201, body: { ok: true, email: data.email, emailSent, redirect: "/dashboard", message: AUTHOR_REGISTERED_MESSAGE } };
}
