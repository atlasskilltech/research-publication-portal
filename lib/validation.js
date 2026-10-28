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
 * Public registration input. Domain-restricted, minimum-length password, and
 * it NEVER reads a role or privilege flag from the client — the route forces
 * every new account to a non-admin Submitter.
 */
export function validateRegister(body) {
  const name = asString(body?.name);
  const email = asString(body?.email).toLowerCase();
  const password = typeof body?.password === "string" ? body.password : "";
  const baseType = asString(body?.baseType).toUpperCase();
  const school = asString(body?.school) || null;
  const rollNo = asString(body?.rollNo) || null;

  const fields = {};
  if (name.length < 2 || name.length > 120) fields.name = "Enter your full name.";
  if (!EMAIL_RE.test(email)) fields.email = "Enter a valid email.";
  else if (!isApprovedEmail(email)) fields.email = "Use an approved university email address.";
  if (password.length < 10) fields.password = "Use at least 10 characters.";
  else if (password.length > 200) fields.password = "That password is too long.";
  if (baseType !== "STUDENT" && baseType !== "FACULTY") fields.baseType = "Choose Student or Faculty.";
  if (school && school.length > 16) fields.school = "Unknown school.";
  if (rollNo && rollNo.length > 64) fields.rollNo = "Roll number is too long.";

  if (Object.keys(fields).length > 0) {
    throw new ValidationError("Please check the form.", { fields });
  }

  return {
    name,
    email,
    password,
    baseType, // STUDENT | FACULTY
    school,
    // A roll number only belongs to a student; faculty never carry one.
    rollNo: baseType === "STUDENT" ? rollNo : null,
  };
}
