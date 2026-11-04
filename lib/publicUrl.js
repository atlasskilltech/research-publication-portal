import "server-only";

/**
 * Absolute URL on the PUBLIC site for a path (e.g. "/login?notice=x").
 *
 * Behind a reverse proxy (nginx → next start on :5630) `request.url` is the
 * internal origin (http://localhost:5630), so redirects built from it send
 * users to localhost. Prefer, in order: NEXT_PUBLIC_SITE_URL, the proxy's
 * X-Forwarded-Host/Proto, then the request URL (local dev).
 */
export function publicUrl(path, request) {
  const site = (process.env.NEXT_PUBLIC_SITE_URL || "").trim();
  if (site) {
    try { return new URL(path, new URL(site).origin); } catch { /* fall through */ }
  }
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (host) {
    const proto = (request.headers.get("x-forwarded-proto") || new URL(request.url).protocol.replace(":", "")).split(",")[0].trim();
    try { return new URL(path, `${proto}://${host.split(",")[0].trim()}`); } catch { /* fall through */ }
  }
  return new URL(path, request.url);
}
