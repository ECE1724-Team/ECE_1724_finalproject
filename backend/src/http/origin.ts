const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export interface OriginCheckInput {
  method: string;
  /** The `Origin` header, if any. */
  origin: string | null | undefined;
  /** The `Sec-Fetch-Site` header, if any. */
  fetchSite: string | null | undefined;
}

/**
 * CSRF protection for cookie-authenticated requests. Browsers send `Origin` on cross-origin
 * requests and on same-origin POST/PUT/DELETE; when it is absent, `Sec-Fetch-Site: cross-site`
 * still marks a cross-site request.
 *
 * - `strict: false` (business API): safe methods (GET/HEAD/OPTIONS) always pass, because they
 *   change nothing and CORS keeps their responses from untrusted pages. Unsafe methods need a
 *   trusted `Origin`, or no `Origin` and no cross-site marker.
 * - `strict: true` (auth endpoints): a present `Origin` must be trusted for every method.
 */
export function isTrustedRequestOrigin(
  { method, origin, fetchSite }: OriginCheckInput,
  trustedOrigins: readonly string[],
  { strict }: { strict: boolean },
): boolean {
  const safe = SAFE_METHODS.has(method.toUpperCase());
  if (origin) return (safe && !strict) || trustedOrigins.includes(origin);
  return safe || fetchSite !== "cross-site";
}
