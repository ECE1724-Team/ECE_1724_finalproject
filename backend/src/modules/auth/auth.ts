import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { betterAuth } from "better-auth";
import type { BetterAuthOptions } from "@better-auth/core";
import { APIError, createAuthMiddleware, createEmailVerificationToken, isAPIError } from "better-auth/api";
import { decodeJwt, jwtVerify, errors as joseErrors } from "jose";
import type { AuthConfig } from "../../config/env.js";
import { Database } from "../../db/transaction.js";
import type { EmailSender } from "../../integrations/email/types.js";
import type { AuthenticatedSession, SessionReader } from "./types.js";
import { validateCallback, withQuery } from "./callbacks.js";
import { CredentialStore, isUuid, type PendingCredential, type CredentialPurpose } from "./credentials.js";
import { AuthFailure, authErrorResponse } from "./errors.js";
import { createPostgresAuthAdapter } from "./pg-adapter.js";
import { createRateLimitStorage } from "./rate-limit.js";

interface RequestState { jobs: PendingCredential[]; issuanceError?: unknown }
export interface Authentication extends SessionReader {
  handler(request: Request): Promise<Response>;
  drainEmailQueue(): Promise<void>;
  close(): Promise<void>;
}
export interface AuthenticationOptions {
  database: Database;
  config: AuthConfig;
  emailSender: EmailSender;
  clock?: () => Date;
  reportError?: (code: string) => void;
  /** Test isolation; the application entry point always leaves this enabled. */
  nativeRateLimitEnabled?: boolean;
}

class RejectedResponse extends Error {
  constructor(readonly response: Response) { super("Authentication rejected"); }
}

const exposedRoutes = new Map<string, string>([
  ["/sign-up/email", "POST"], ["/sign-in/email", "POST"], ["/sign-out", "POST"],
  ["/get-session", "GET"], ["/send-verification-email", "POST"],
  ["/verify-email", "GET"], ["/request-password-reset", "POST"],
  ["/reset-password", "POST"], ["/change-password", "POST"],
  ["/update-user", "POST"], ["/list-sessions", "GET"], ["/revoke-session", "POST"],
  ["/error", "GET"],
]);
const protectedAuthRoutes = new Set(["/change-password", "/update-user", "/list-sessions", "/revoke-session"]);

export function createAuthentication(options: AuthenticationOptions): Authentication {
  const { database, config, emailSender } = options;
  const clock = options.clock ?? (() => new Date());
  const report = options.reportError ?? ((code: string) => console.error("Authentication failure:", code));
  const requests = new AsyncLocalStorage<RequestState>();
  const credentials = new CredentialStore(database, config, clock);
  const pending = new Set<Promise<void>>();
  // Rate counters must survive failed auth transactions. A dedicated small pool
  // avoids pool starvation while account transactions hold their own clients.
  const ratePool = new pg.Pool({ ...database.pool.options, max: 2 });
  // This pool is not made by createPool(), so it needs its own listener: an idle client that
  // loses its connection (e.g. a PostgreSQL restart) would otherwise crash the process.
  ratePool.on("error", (error) => { console.error("Rate-limit pool error:", error); });
  let nativeAuth: ReturnType<typeof betterAuth>;

  const readSession = async (headers: Headers): Promise<AuthenticatedSession | null> =>
    nativeAuth.api.getSession({ headers, query: { disableCookieCache: true, disableRefresh: true } });

  async function recordCandidate(job: Omit<PendingCredential, "sequence">): Promise<void> {
    const state = requests.getStore();
    if (!state) throw new Error("Email issuance must use the project auth handler");
    try { state.jobs.push(await credentials.prepare(job)); }
    catch (error) { state.issuanceError = error; throw error; }
  }

  nativeAuth = betterAuth<BetterAuthOptions>({
    appName: "JobFlow AI",
    baseURL: config.baseUrl,
    basePath: "/api/auth",
    secret: config.secret,
    trustedOrigins: config.trustedOrigins,
    database: createPostgresAuthAdapter(database),
    user: { modelName: "auth_user" },
    account: { modelName: "auth_account" },
    verification: { modelName: "auth_verification" },
    session: {
      modelName: "auth_session",
      expiresIn: config.sessionLifetimeSeconds,
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: options.nativeRateLimitEnabled ?? true,
      storage: "database",
      modelName: "auth_rate_limit",
      customStorage: createRateLimitStorage(ratePool, config.secret),
    },
    advanced: {
      database: { generateId: "uuid", joins: false, validateSchema: false },
      useSecureCookies: config.secureCookies,
      defaultCookieAttributes: { httpOnly: true, secure: config.secureCookies, sameSite: config.cookieSameSite },
      ipAddress: { ipAddressHeaders: ["x-jobflow-client-ip"] },
      disableOriginCheck: false,
      disableCSRFCheck: false,
    },
    logger: { disabled: true },
    // Better Auth calls this for every endpoint error, including expected 4xx answers such as
    // a wrong password or an expired link. Only unexpected failures are worth reporting.
    onAPIError: {
      onError: (error) => {
        if (!isAPIError(error) || error.statusCode >= 500) report("BETTER_AUTH_INTERNAL");
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: false,
      resetPasswordTokenExpiresIn: 900,
      revokeSessionsOnPasswordReset: true,
      async sendResetPassword({ user, token, url }) {
        try {
          const record = await credentials.resetRecord(token);
          if (!record || record.userId !== user.id) throw new Error("Missing native reset credential");
          await recordCandidate({
            to: user.email, url, purpose: "password_reset", userId: user.id,
            token, issuanceId: randomUUID(), expiresAt: record.expiresAt,
            issuedAt: new Date(record.expiresAt.getTime() - 900_000),
          });
        } catch (error) {
          const state = requests.getStore();
          if (state) state.issuanceError = error;
          throw error;
        }
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: false,
      autoSignInAfterVerification: true,
      expiresIn: 900,
      async sendVerificationEmail({ user, url }) {
        try {
          const issuanceId = randomUUID();
          const token = await createEmailVerificationToken(config.secret, user.email, undefined, 900, { userId: user.id, jti: issuanceId });
          const claims = decodeJwt(token);
          if (typeof claims.iat !== "number" || typeof claims.exp !== "number") throw new Error("Missing credential timestamps");
          const link = new URL(url);
          link.searchParams.set("token", token);
          await recordCandidate({
            to: user.email, url: link.href, purpose: "email_verification", userId: user.id,
            token, issuanceId, issuedAt: new Date(claims.iat * 1000), expiresAt: new Date(claims.exp * 1000),
          });
        } catch (error) {
          const state = requests.getStore();
          if (state) state.issuanceError = error;
          throw error;
        }
      },
    },
    hooks: {
      before: createAuthMiddleware(async ctx => {
        const path = ctx.path;
        const body: Record<string, unknown> = ctx.body ?? {};
        const query: Record<string, unknown> = ctx.query ?? {};
        try {
          for (const value of [body.callbackURL, body.redirectTo, query.callbackURL]) validateCallback(value, config.trustedOrigins);
          if (["/sign-up/email", "/send-verification-email", "/request-password-reset"].includes(path) && typeof body.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
            const purpose: CredentialPurpose = path === "/request-password-reset" ? "password_reset" : "email_verification";
            await credentials.reserveEmailRequest(body.email, purpose);
            await credentials.lockUserByEmail(body.email);
          }
          // Serialize password verification + Session creation against reset.
          if (path === "/sign-in/email" && typeof body.email === "string") await credentials.lockUserByEmail(body.email);
          if (protectedAuthRoutes.has(path)) {
            const session = await readSession(ctx.headers ?? new Headers());
            if (!session) throw new AuthFailure(401, "UNAUTHORIZED", "Authentication required");
            const user = await credentials.lockUserById(session.user.id);
            if (!user?.emailVerified) throw new AuthFailure(403, "EMAIL_NOT_VERIFIED", "Verify your email before using this operation");
            // Reset may have revoked the session while the user lock was pending.
            if (!await readSession(ctx.headers ?? new Headers())) throw new AuthFailure(401, "UNAUTHORIZED", "Authentication required");
          }
          if (path === "/verify-email" && typeof query.token === "string") {
            let expired = false;
            let payload: ReturnType<typeof decodeJwt>;
            try {
              payload = decodeJwt(query.token);
              await jwtVerify(query.token, new TextEncoder().encode(config.secret), { algorithms: ["HS256"], currentDate: clock() });
            } catch (error) {
              if (error instanceof joseErrors.JWTExpired) { expired = true; payload = decodeJwt(query.token); }
              else throw new AuthFailure(401, "INVALID_TOKEN", "Invalid verification credential");
            }
            if (!isUuid(payload.userId) || !isUuid(payload.jti) || typeof payload.email !== "string" || payload.updateTo !== undefined) throw new AuthFailure(401, "INVALID_TOKEN", "Invalid verification credential");
            const user = await credentials.lockUserById(payload.userId);
            if (!user) throw new AuthFailure(401, "USER_NOT_FOUND", "User not found");
            if (user.email !== payload.email.toLowerCase()) throw new AuthFailure(401, "INVALID_TOKEN", "Invalid verification credential");
            const state = await credentials.checkLatest(user.id, "email_verification", query.token, payload.jti);
            if (state === "invalid") throw new AuthFailure(401, "INVALID_TOKEN", "Invalid or superseded verification credential");
            if (state === "expired" || expired) throw new AuthFailure(401, "TOKEN_EXPIRED", "Verification credential has expired");
          }
          if (path === "/reset-password" || path.startsWith("/reset-password/")) {
            const callback = path !== "/reset-password";
            const token = callback ? ctx.params?.token : body.token ?? query.token;
            if (callback && !Object.hasOwn(query, "callbackURL")) throw new AuthFailure(400, "VALIDATION_ERROR", "callbackURL is required");
            if (callback && query.callbackURL === "") {
              throw ctx.redirect(`${config.baseUrl}/api/auth/error?error=INVALID_TOKEN`);
            }
            if (typeof token !== "string" || token.length > 8192) throw new AuthFailure(400, "INVALID_TOKEN", "Invalid password reset credential");
            let record = await credentials.resetRecord(token);
            if (!record || !await credentials.lockUserById(record.userId)) throw new AuthFailure(400, "INVALID_TOKEN", "Invalid password reset credential");
            // Repeat native lookup after taking the shared user lock.
            record = await credentials.resetRecord(token);
            if (!record || record.expiresAt.getTime() <= clock().getTime() || await credentials.checkLatest(record.userId, "password_reset", token) !== "valid") throw new AuthFailure(400, "INVALID_TOKEN", "Invalid or expired password reset credential");
          }
        } catch (error) {
          if (!(error instanceof AuthFailure)) throw error;
          if (error.code !== "INVALID_CALLBACK_URL" && error.status !== 403 && path === "/verify-email" && typeof query.token === "string" && typeof query.callbackURL === "string" && query.callbackURL) {
            throw ctx.redirect(withQuery(query.callbackURL, config.baseUrl, "error", error.code));
          }
          if (error.code === "INVALID_TOKEN" && path.startsWith("/reset-password/") && typeof query.callbackURL === "string" && query.callbackURL) {
            throw ctx.redirect(withQuery(query.callbackURL, config.baseUrl, "error", "INVALID_TOKEN"));
          }
          throw new APIError(error.status === 429 ? "TOO_MANY_REQUESTS" : error.status === 403 ? "FORBIDDEN" : error.status === 401 ? "UNAUTHORIZED" : "BAD_REQUEST", {
            code: error.code, message: error.message,
          }, error.retryAfter === undefined ? undefined : { "Retry-After": String(error.retryAfter) });
        }
      }),
    },
  });

  function enqueue(job: PendingCredential): void {
    const work = (async () => {
      try {
        await emailSender.sendAuthEmail(job);
        await credentials.activate(job);
      } catch { report("AUTH_EMAIL_DELIVERY_OR_ACTIVATION_FAILED"); }
    })();
    pending.add(work);
    void work.finally(() => pending.delete(work));
  }

  return {
    getSession: readSession,
    async handler(request) {
      const url = new URL(request.url);
      const path = url.pathname.slice("/api/auth".length);
      const method = /^\/reset-password\/[^/]+$/.test(path) ? "GET" : exposedRoutes.get(path);
      if (!url.pathname.startsWith("/api/auth/") || !method) return authErrorResponse(new AuthFailure(404, "NOT_FOUND", "Authentication endpoint not found"));
      if (request.method !== method) return authErrorResponse(new AuthFailure(405, "METHOD_NOT_ALLOWED", "Method not allowed"));
      const origin = request.headers.get("origin");
      if (origin && !config.trustedOrigins.includes(origin) || !origin && request.method !== "GET" && request.headers.get("sec-fetch-site") === "cross-site") {
        return authErrorResponse(new AuthFailure(403, "INVALID_ORIGIN", "Untrusted request origin"));
      }
      const state: RequestState = { jobs: [] };
      return requests.run(state, async () => {
        try {
          // Global Better Auth origin/CSRF/rate checks remain in its handler.
          // Our own PoolClient ALS survives its adapter-context boundary.
          const response = await database.transaction(async () => {
            const result = await nativeAuth.handler(request);
            if (state.issuanceError) throw state.issuanceError;
            if (result.status >= 500) throw new RejectedResponse(authErrorResponse(new AuthFailure(500, "INTERNAL_SERVER_ERROR", "Authentication could not be completed")));
            if (result.status >= 400) throw new RejectedResponse(result);
            return result;
          });
          // Accepted is deliberately generic: mail delivery and account
          // existence cannot be inferred from the anonymous response.
          for (const job of state.jobs) enqueue(job);
          return response;
        } catch (error) {
          if (error instanceof RejectedResponse) return error.response;
          if (error instanceof AuthFailure) return authErrorResponse(error);
          report("AUTH_TRANSACTION_FAILED");
          return authErrorResponse(new AuthFailure(500, "INTERNAL_SERVER_ERROR", "Authentication could not be completed"));
        }
      });
    },
    async drainEmailQueue() { while (pending.size) await Promise.all([...pending]); },
    async close() { while (pending.size) await Promise.all([...pending]); await ratePool.end(); },
  };
}
