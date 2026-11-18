import { createAuthMiddleware } from "better-auth/api";
import { jwtVerify, errors as joseErrors, type JWTPayload } from "jose";
import type { AuthConfig } from "../../config/env.js";
import { isUuid } from "../../lib/uuid.js";
import { validateCallback, withQuery } from "./callbacks.js";
import { AUTH_BASE_PATH } from "./constants.js";
import type { CredentialPurpose, CredentialStore } from "./credentials.js";
import { AuthFailure, toAPIError } from "./errors.js";
import { EMAIL_ROUTES, SESSION_ROUTES, isResetLink } from "./routes.js";
import type { AuthenticatedSession } from "./types.js";

interface HookRequest {
  path: string;
  body: Record<string, unknown>;
  query: Record<string, unknown>;
  params: Record<string, unknown>;
  headers: Headers;
}

export interface GuardDependencies {
  config: AuthConfig;
  credentials: CredentialStore;
  readSession(headers: Headers): Promise<AuthenticatedSession | null>;
  clock(): Date;
}

const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_TOKEN_LENGTH = 8192;

const unauthorized = () => new AuthFailure(401, "UNAUTHORIZED", "Authentication required");
const invalidVerification = (message = "Invalid verification credential") => new AuthFailure(401, "INVALID_TOKEN", message);
const invalidReset = (message = "Invalid password reset credential") => new AuthFailure(400, "INVALID_TOKEN", message);

/**
 * Better Auth `before` hook: the project checks that run inside the request transaction before
 * the library's own endpoint logic. Each exposed path has one guard. The guards lock the user row
 * before Better Auth writes anything, so issuance, sign-in, verification and reset are serialized
 * per user, always in the order email-limit row → user → credential state (Database Design
 * Appendix E.3). A rejection becomes Better Auth's error body, or a redirect to a trusted
 * callback where endpoints.json asks for one.
 */
export function createBeforeHook({ config, credentials, readSession, clock }: GuardDependencies) {
  const verificationKey = new TextEncoder().encode(config.secret);

  /** sign-up, send-verification-email, request-password-reset. */
  async function guardEmailRequest(email: unknown, purpose: CredentialPurpose): Promise<void> {
    // Better Auth rejects malformed input itself; only a plausible address uses up quota.
    if (typeof email !== "string" || !LOOKS_LIKE_EMAIL.test(email)) return;
    // Applied to unknown and already-verified addresses too, so it reveals nothing.
    await credentials.reserveEmailRequest(email, purpose);
    await credentials.lockUserByEmail(email);
  }

  /** sign-in: serialize password check + Session creation against a concurrent reset. */
  async function guardSignIn(email: unknown): Promise<void> {
    if (typeof email === "string") await credentials.lockUserByEmail(email);
  }

  /** change-password, update-user, list-sessions, revoke-session. */
  async function guardSessionRoute(headers: Headers): Promise<void> {
    const session = await readSession(headers);
    if (!session) throw unauthorized();
    const user = await credentials.lockUserById(session.user.id);
    if (!user?.emailVerified) throw new AuthFailure(403, "EMAIL_NOT_VERIFIED", "Verify your email before using this operation");
    // A reset may have revoked the Session while this request waited for the user lock.
    if (!await readSession(headers)) throw unauthorized();
  }

  /** verify-email: only the user's latest activated verification link is accepted. */
  async function guardVerifyEmail(token: string): Promise<void> {
    let claims: JWTPayload;
    let expired = false;
    try {
      ({ payload: claims } = await jwtVerify(token, verificationKey, { algorithms: ["HS256"], currentDate: clock() }));
    } catch (error) {
      // jose checks the signature before expiry, so an expired token's claims are authentic.
      if (!(error instanceof joseErrors.JWTExpired)) throw invalidVerification();
      expired = true;
      claims = error.payload;
    }
    // `updateTo` marks Better Auth's change-email tokens, which this project does not accept.
    if (!isUuid(claims.userId) || !isUuid(claims.jti) || typeof claims.email !== "string" || claims.updateTo !== undefined) {
      throw invalidVerification();
    }
    const user = await credentials.lockUserById(claims.userId);
    if (!user) throw new AuthFailure(401, "USER_NOT_FOUND", "User not found");
    if (user.email !== claims.email.toLowerCase()) throw invalidVerification();
    const state = await credentials.checkLatest(user.id, "email_verification", token, claims.jti);
    if (state === "invalid") throw invalidVerification("Invalid or superseded verification credential");
    if (state === "expired" || expired) throw new AuthFailure(401, "TOKEN_EXPIRED", "Verification credential has expired");
  }

  /**
   * reset-password (POST) and the emailed link (GET /reset-password/{token}). The GET only checks
   * and redirects; the POST repeats every check, because a resend or expiry in between must win.
   * Returns a redirect target when the GET has an empty callbackURL.
   */
  async function guardResetPassword({ path, body, query, params }: HookRequest): Promise<string | undefined> {
    const link = isResetLink(path);
    if (link && !Object.hasOwn(query, "callbackURL")) throw new AuthFailure(400, "VALIDATION_ERROR", "callbackURL is required");
    if (link && query.callbackURL === "") return `${config.baseUrl}${AUTH_BASE_PATH}/error?error=INVALID_TOKEN`;
    const token = link ? params.token : body.token ?? query.token;
    if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) throw invalidReset();
    const found = await credentials.resetRecord(token);
    if (!found || !await credentials.lockUserById(found.userId)) throw invalidReset();
    // Look again under the user lock: a concurrent reset may have consumed it meanwhile.
    const record = await credentials.resetRecord(token);
    if (!record || record.expiresAt.getTime() <= clock().getTime()
      || await credentials.checkLatest(record.userId, "password_reset", token) !== "valid") {
      throw invalidReset("Invalid or expired password reset credential");
    }
    return undefined;
  }

  async function guard(request: HookRequest): Promise<string | undefined> {
    const { path, body, query } = request;
    for (const value of [body.callbackURL, body.redirectTo, query.callbackURL]) validateCallback(value, config.trustedOrigins);
    const purpose = EMAIL_ROUTES.get(path);
    if (purpose) await guardEmailRequest(body.email, purpose);
    else if (path === "/sign-in/email") await guardSignIn(body.email);
    else if (SESSION_ROUTES.has(path)) await guardSessionRoute(request.headers);
    else if (path === "/verify-email") { if (typeof query.token === "string") await guardVerifyEmail(query.token); }
    else if (path === "/reset-password" || isResetLink(path)) return guardResetPassword(request);
    return undefined;
  }

  /** endpoints.json: link callbacks with a trusted callbackURL report failures by redirecting. */
  function failureRedirect({ path, query }: HookRequest, error: AuthFailure): string | undefined {
    const callbackURL = typeof query.callbackURL === "string" && query.callbackURL ? query.callbackURL : undefined;
    if (!callbackURL) return undefined;
    // 403 means the callback itself is untrusted: never redirect to it.
    if (path === "/verify-email" && typeof query.token === "string" && error.status !== 403) {
      return withQuery(callbackURL, config.baseUrl, "error", error.code);
    }
    if (isResetLink(path) && error.code === "INVALID_TOKEN") return withQuery(callbackURL, config.baseUrl, "error", "INVALID_TOKEN");
    return undefined;
  }

  return createAuthMiddleware(async (ctx) => {
    const request: HookRequest = {
      path: ctx.path,
      body: ctx.body ?? {},
      query: ctx.query ?? {},
      params: ctx.params ?? {},
      headers: ctx.headers ?? new Headers(),
    };
    let redirect: string | undefined;
    try {
      redirect = await guard(request);
    } catch (error) {
      if (!(error instanceof AuthFailure)) throw error;
      const target = failureRedirect(request, error);
      if (target) throw ctx.redirect(target);
      throw toAPIError(error);
    }
    if (redirect) throw ctx.redirect(redirect);
  });
}
