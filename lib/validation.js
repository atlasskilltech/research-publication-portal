// Server-side validation for auth flows. All auth input is validated here
// before it reaches the database.
import { z } from "zod";

// Approved institutional email domain(s).
// Source: open-questions-and-assumptions.md (B4) -> atlasuniversity.edu.in.
// Overridable via ALLOWED_EMAIL_DOMAINS (comma-separated) without code changes.
const DEFAULT_DOMAINS = ["atlasuniversity.edu.in"];

export function allowedDomains() {
  const raw = process.env.ALLOWED_EMAIL_DOMAINS;
  if (!raw) return DEFAULT_DOMAINS;
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isApprovedEmail(email) {
  const e = String(email || "").toLowerCase();
  return allowedDomains().some((d) => e.endsWith("@" + d));
}

// Login stays lenient on domain (identity is proven against the DB in authorize()).
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// Public registration: domain-restricted, strong password, never accepts a role.
export const registerSchema = z.object({
  name: z.string().trim().min(2, "Enter your full name.").max(120),
  email: z
    .string()
    .email("Enter a valid email.")
    .transform((s) => s.toLowerCase())
    .refine(isApprovedEmail, {
      message: "Use an approved university email address.",
    }),
  password: z.string().min(10, "Use at least 10 characters.").max(200),
  baseType: z.enum(["STUDENT", "FACULTY"]),
  school: z.string().max(16).optional().nullable(),
  rollNo: z.string().max(64).optional().nullable(),
});
