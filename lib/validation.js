import "server-only";

import { allowedEmailDomains } from "@/lib/config/env";
import { ValidationError } from "@/lib/errors";

/**
 * Server-side validation for the auth flows.
 *
 * Hand-rolled (no schema library) to keep the dependency surface small and
 * consistent with the rest of the backend. Every function returns a clean,
 * normalised value object or throws a `ValidationError` the route turns into a
 * 422 — the client never reaches the database with unchecked input.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isApprovedEmail(email) {
  const e = String(email || "").toLowerCase();
  return allowedEmailDomains().some((domain) => e.endsWith("@" + domain));
}

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Login input. Deliberately lenient on the email's domain: identity is proven
 * against the database, and a domain check here would only help an attacker
 * tell "no such account" from "wrong domain".
 */
export function validateLogin(body) {
  const email = asString(body?.email).toLowerCase();
  const password = typeof body?.password === "string" ? body.password : "";
  if (!EMAIL_RE.test(email) || password.length === 0) {
    // One generic message — never reveal which field was wrong.
    throw new ValidationError("Invalid email or password.");
  }
  return { email, password };
}

/**
 * Normalise an Application Number to a stable, comparable form: trim, strip
 * surrounding whitespace, and upper-case. The uniqueness check and the external
 * API both see the same normalised value so "2629885" and " 2629885 " collide.
 */
export function normalizeApplicationNo(value) {
  return asString(value).replace(/\s+/g, "").toUpperCase();
}

/**
 * Public registration input. Passwordless — a password is NEVER collected here
 * (the user sets one after email verification), and the route NEVER reads a role
 * or privilege flag from the client: every new account is a non-admin Submitter.
 *
 * Students must supply an Application Number (verified server-side against the
 * university API); faculty never do. `school` is optional for both.
 */
export function validateRegister(body) {
  const name = asString(body?.name);
  const email = asString(body?.email).toLowerCase();
  const baseType = asString(body?.baseType).toUpperCase();
  const school = asString(body?.school) || null;
  const applicationNo =
    baseType === "STUDENT" ? normalizeApplicationNo(body?.applicationNo) : "";

  const fields = {};
  if (name.length < 2 || name.length > 120) fields.name = "Enter your full name.";
  if (!EMAIL_RE.test(email)) fields.email = "Enter a valid email.";
  else if (!isApprovedEmail(email)) fields.email = "Use an approved university email address.";
  if (baseType !== "STUDENT" && baseType !== "FACULTY") fields.baseType = "Choose Student or Faculty.";
  if (school && school.length > 16) fields.school = "Unknown school.";
  if (baseType === "STUDENT") {
    if (!applicationNo) fields.applicationNo = "Enter your application number.";
    else if (applicationNo.length > 64) fields.applicationNo = "That application number is too long.";
  }

  if (Object.keys(fields).length > 0) {
    throw new ValidationError("Please check the form.", { fields });
  }

  return {
    name,
    email,
    baseType, // STUDENT | FACULTY
    school,
    // An application number only belongs to a student; faculty never carry one.
    applicationNo: baseType === "STUDENT" ? applicationNo : null,
  };
}

/**
 * Password chosen on the Create Password page (after email verification). Same
 * minimum strength the account will be held to; the two-field confirmation is a
 * client-side convenience, re-checked here only for length.
 */
export function validatePassword(body) {
  const password = typeof body?.password === "string" ? body.password : "";
  const fields = {};
  if (password.length < 10) fields.password = "Use at least 10 characters.";
  else if (password.length > 200) fields.password = "That password is too long.";
  if (Object.keys(fields).length > 0) {
    throw new ValidationError("Please check the form.", { fields });
  }
  return { password };
}
