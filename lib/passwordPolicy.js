// Password policy shared by the browser form and the server (no Node imports,
// so it can be bundled client-side). Mirrors lib/validation.js validatePassword:
// the hard rule is 10–200 characters; strength is guidance only.
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;

export function validatePasswordPair(password, confirm) {
  const p = typeof password === "string" ? password : "";
  const c = typeof confirm === "string" ? confirm : "";
  if (p.length < PASSWORD_MIN) return { ok: false, field: "password", error: `Use at least ${PASSWORD_MIN} characters.` };
  if (p.length > PASSWORD_MAX) return { ok: false, field: "password", error: "That password is too long." };
  if (p !== c) return { ok: false, field: "confirm", error: "The passwords don't match." };
  return { ok: true };
}

/** Guidance only: score 0–4, label and hints. */
export function passwordStrength(password) {
  const p = typeof password === "string" ? password : "";
  const hints = [];
  let score = 0;
  if (p.length >= PASSWORD_MIN) score++; else hints.push(`At least ${PASSWORD_MIN} characters`);
  if (p.length >= 14) score++; else hints.push("14+ characters is stronger");
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) score++; else hints.push("Mix upper- and lower-case letters");
  if (/\d/.test(p) && /[^A-Za-z0-9]/.test(p)) score++; else hints.push("Add numbers and symbols");
  const label = ["Too short", "Weak", "Fair", "Good", "Strong"][score];
  return { score, label, hints };
}
