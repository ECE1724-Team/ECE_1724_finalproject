import type { BetterAuthOptions } from "@better-auth/core";
import { isAPIError } from "better-auth/api";
import type { Pool } from "pg";
import type { AuthConfig } from "../../config/env.js";
import type { Database } from "../../db/transaction.js";
import { AUTH_BASE_PATH, CLIENT_IP_HEADER, CREDENTIAL_LIFETIME_SECONDS } from "./constants.js";
import type { createBeforeHook } from "./guards.js";
import type { createIssuance } from "./issuance.js";
import { createPostgresAuthAdapter } from "./pg-adapter.js";
import { createRateLimitStorage } from "./rate-limit.js";

export interface NativeOptionsInput {
  config: AuthConfig;
  database: Database;
  rateLimitPool: Pool;
  nativeRateLimitEnabled: boolean;
  issuance: ReturnType<typeof createIssuance>;
  beforeHook: ReturnType<typeof createBeforeHook>;
  /** Called for non-API errors and 5xx answers; expected 4xx rejections are not reported. */
  onInternalError(error: unknown): void;
}

/**
 * The Better Auth configuration. Each setting below implements a confirmed rule; the table in
 * Database Design Appendix E.4 lists them.
 */
export function buildBetterAuthOptions(input: NativeOptionsInput): BetterAuthOptions {
  const { config, database, rateLimitPool, issuance } = input;
  return {
    appName: "JobFlow AI",
    baseURL: config.baseUrl,
    basePath: AUTH_BASE_PATH,
    secret: config.secret,
    trustedOrigins: config.trustedOrigins,
    database: createPostgresAuthAdapter(database),
    user: { modelName: "auth_user" },
    account: { modelName: "auth_account" },
    verification: { modelName: "auth_verification" },
    session: {
      modelName: "auth_session",
      expiresIn: config.sessionLifetimeSeconds,
      // PostgreSQL is the only Session store, so revocation takes effect immediately.
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: input.nativeRateLimitEnabled,
      storage: "database",
      modelName: "auth_rate_limit",
      // Separate pool: counters survive a rolled-back request transaction.
      customStorage: createRateLimitStorage(rateLimitPool, config.secret),
    },
    advanced: {
      database: { generateId: "uuid", joins: false, validateSchema: false },
      useSecureCookies: config.secureCookies,
      defaultCookieAttributes: { httpOnly: true, secure: config.secureCookies, sameSite: config.cookieSameSite },
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
      disableOriginCheck: false,
      disableCSRFCheck: false,
    },
    logger: { disabled: true },
    // Better Auth calls this for every endpoint error, including expected 4xx answers such as
    // a wrong password or an expired link. Only unexpected failures are worth reporting.
    onAPIError: {
      onError: (error) => {
        if (!isAPIError(error) || error.statusCode >= 500) input.onInternalError(error);
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,  // unverified users cannot sign in
      autoSignIn: false,               // registration returns token: null, no Session
      resetPasswordTokenExpiresIn: CREDENTIAL_LIFETIME_SECONDS,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: issuance.sendResetPassword,
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: false,
      autoSignInAfterVerification: true, // the first verification establishes a Session
      expiresIn: CREDENTIAL_LIFETIME_SECONDS,
      sendVerificationEmail: issuance.sendVerificationEmail,
    },
    hooks: { before: input.beforeHook },
  };
}
