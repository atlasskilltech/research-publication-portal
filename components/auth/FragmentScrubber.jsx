"use client";

import { useEffect } from "react";

/**
 * Keeps auth secrets out of the address bar and browser history:
 *  - always removes a URL fragment carrying tokens (e.g. "#access_token=…" from
 *    an OLD-format email link) — the tokens are NOT read or used;
 *  - with `stripQuery`, also removes ?token_hash=… once the page has rendered
 *    (the server already placed it in the form's hidden fields).
 */
export default function FragmentScrubber({ stripQuery = false }) {
  useEffect(() => {
    const { hash, search, pathname } = window.location;
    const dirtyHash = hash && /access_token|refresh_token|error_code|token/i.test(hash);
    const dirtyQuery = stripQuery && /token_hash=|[?&]token=/.test(search);
    if (dirtyHash || dirtyQuery) {
      window.history.replaceState(null, "", pathname + (dirtyQuery ? "" : search));
    }
  }, [stripQuery]);
  return null;
}
