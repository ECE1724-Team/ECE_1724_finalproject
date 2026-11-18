import { AUTH_BASE_PATH } from "./constants.js";

type Method = "GET" | "POST";

/**
 * The Better Auth endpoints this project exposes (endpoints.json). Every other library endpoint
 * answers 404, so enabling a library feature never publishes a route by accident.
 */
const EXPOSED_ROUTES: ReadonlyMap<string, Method> = new Map<string, Method>([
  ["/sign-up/email", "POST"],
  ["/sign-in/email", "POST"],
  ["/sign-out", "POST"],
  ["/get-session", "GET"],
  ["/send-verification-email", "POST"],
  ["/verify-email", "GET"],
  ["/request-password-reset", "POST"],
  ["/reset-password", "POST"],
  ["/change-password", "POST"],
  ["/update-user", "POST"],
  ["/list-sessions", "GET"],
  ["/revoke-session", "POST"],
  ["/error", "GET"], // target of a reset-link callback with an empty callbackURL
]);

/** The emailed reset link, `GET /reset-password/{token}`. */
const RESET_LINK = /^\/reset-password\/[^/]+$/;

/** Account endpoints that need a current, verified Session (checked again under the user lock). */
export const SESSION_ROUTES: ReadonlySet<string> = new Set(["/change-password", "/update-user", "/list-sessions", "/revoke-session"]);

/** Paths that issue an email, and the credential purpose each one issues. */
export const EMAIL_ROUTES: ReadonlyMap<string, "email_verification" | "password_reset"> = new Map([
  ["/sign-up/email", "email_verification"],
  ["/send-verification-email", "email_verification"],
  ["/request-password-reset", "password_reset"],
] as const);

export function isResetLink(path: string): boolean {
  return RESET_LINK.test(path);
}

/** Path below `/api/auth` and its only allowed method, or null for an unexposed endpoint. */
export function resolveAuthRoute(pathname: string): { path: string; method: Method } | null {
  if (!pathname.startsWith(`${AUTH_BASE_PATH}/`)) return null;
  const path = pathname.slice(AUTH_BASE_PATH.length);
  const method = isResetLink(path) ? "GET" : EXPOSED_ROUTES.get(path);
  return method ? { path, method } : null;
}
