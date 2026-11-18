/** Where Better Auth is mounted (endpoints.json `/api/auth/*`). */
export const AUTH_BASE_PATH = "/api/auth";

/**
 * Lifetime of email-verification and password-reset credentials: 900 seconds after issuance
 * (PRD FR-32/FR-33, confirmed requirement, not configuration). Independent of the Session lifetime.
 */
export const CREDENTIAL_LIFETIME_SECONDS = 900;

/**
 * Internal header carrying the proxy-aware client IP to Better Auth's rate limiter. The Express
 * integration always overwrites it, so callers cannot choose their own rate-limit identity.
 */
export const CLIENT_IP_HEADER = "x-jobflow-client-ip";
