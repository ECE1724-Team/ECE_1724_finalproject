import { APIError } from "better-auth/api";
// Shared PostgreSQL outage test (also used by app.ts); it lives with the resume module.
import { isDbUnavailable } from "../resumes/errors.js";

/** `code` values this project sends in Better Auth's error body (endpoints.json `BetterAuthError`). */
export type AuthFailureCode =
  | "UNAUTHORIZED" | "EMAIL_NOT_VERIFIED" | "VALIDATION_ERROR"
  | "INVALID_TOKEN" | "TOKEN_EXPIRED" | "USER_NOT_FOUND"
  | "INVALID_CALLBACK_URL" | "INVALID_ORIGIN"
  | "EMAIL_COOLDOWN" | "EMAIL_RATE_LIMIT"
  | "NOT_FOUND" | "METHOD_NOT_ALLOWED"
  | "INTERNAL_SERVER_ERROR" | "SERVICE_UNAVAILABLE";

/** Codes passed to `reportError` for the server log. They never carry user data. */
export type AuthReportCode =
  | "BETTER_AUTH_INTERNAL"              // Better Auth hit a non-API error or answered 5xx
  | "AUTH_TRANSACTION_FAILED"           // the request transaction failed unexpectedly
  | "AUTH_DATABASE_UNAVAILABLE"         // PostgreSQL could not be reached (answered 503)
  | "AUTH_EMAIL_DELIVERY_FAILED"        // SMTP did not accept a queued auth email
  | "AUTH_CREDENTIAL_ACTIVATION_FAILED"; // SMTP accepted it, but activating the new link failed

/** An expected rejection with a public status, code and message. */
export class AuthFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: AuthFailureCode,
    message: string,
    readonly retryAfter?: number,
  ) { super(message); }
}

export const SERVICE_UNAVAILABLE = new AuthFailure(503, "SERVICE_UNAVAILABLE", "Authentication is temporarily unavailable. Please try again.");
export const INTERNAL_FAILURE = new AuthFailure(500, "INTERNAL_SERVER_ERROR", "Authentication could not be completed");

/** Better Auth's error body: `{ code, message }`, plus `Retry-After` for 429. */
export function authErrorResponse(error: AuthFailure): Response {
  return Response.json({ code: error.code, message: error.message }, {
    status: error.status,
    headers: error.retryAfter === undefined ? {} : { "Retry-After": String(error.retryAfter) },
  });
}

const NATIVE_STATUS: Readonly<Record<number, ConstructorParameters<typeof APIError>[0]>> = {
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  429: "TOO_MANY_REQUESTS",
};

/** Converts a rejection raised inside a Better Auth hook into the library's own error. */
export function toAPIError(error: AuthFailure): APIError {
  return new APIError(NATIVE_STATUS[error.status] ?? "BAD_REQUEST", { code: error.code, message: error.message },
    error.retryAfter === undefined ? undefined : { "Retry-After": String(error.retryAfter) });
}

/** An unexpected error: 503 when PostgreSQL is unreachable (worth a retry), otherwise 500. */
export function unexpectedFailure(error: unknown): { failure: AuthFailure; report: AuthReportCode } {
  return isDbUnavailable(error)
    ? { failure: SERVICE_UNAVAILABLE, report: "AUTH_DATABASE_UNAVAILABLE" }
    : { failure: INTERNAL_FAILURE, report: "AUTH_TRANSACTION_FAILED" };
}
