import { betterAuth } from "better-auth";
import type { BetterAuthOptions } from "@better-auth/core";
import type { Pool } from "pg";
import type { AuthConfig } from "../../config/env.js";
import type { Database } from "../../db/transaction.js";
import { isTrustedRequestOrigin } from "../../http/origin.js";
import type { EmailSender } from "../../integrations/email/types.js";
import { CredentialStore } from "./credentials.js";
import { AuthFailure, authErrorResponse, unexpectedFailure, type AuthReportCode } from "./errors.js";
import { createBeforeHook } from "./guards.js";
import { createIssuance } from "./issuance.js";
import { buildBetterAuthOptions } from "./options.js";
import { createEmailOutbox } from "./outbox.js";
import { createRequestScopes } from "./request-scope.js";
import { resolveAuthRoute } from "./routes.js";
import type { AuthenticatedSession, SessionReader } from "./types.js";

export interface Authentication extends SessionReader {
  /** Handles one `/api/auth/*` request (Fetch API), as mounted by `createApp`. */
  handler(request: Request): Promise<Response>;
  /** Waits until every queued auth email has been sent and activated or has failed. */
  drainEmailQueue(): Promise<void>;
  /** Drains the email queue. The caller closes both pools afterwards. */
  close(): Promise<void>;
}

export interface AuthenticationOptions {
  database: Database;
  /**
   * A second pool for Better Auth's IP/path rate-limit counters. They are written outside the
   * request transaction, so a rolled-back sign-in still counts. The caller creates and ends it.
   */
  rateLimitPool: Pool;
  config: AuthConfig;
  emailSender: EmailSender;
  clock?: () => Date;
  reportError?: (code: AuthReportCode) => void;
  /** Test isolation; the application entry point always leaves this enabled. */
  nativeRateLimitEnabled?: boolean;
}

/** A Better Auth answer that must not be committed (4xx/5xx): roll back, then send it. */
class RejectedResponse extends Error {
  constructor(readonly response: Response) { super("Authentication rejected"); }
}

export function createAuthentication(options: AuthenticationOptions): Authentication {
  const { database, config, emailSender } = options;
  const clock = options.clock ?? (() => new Date());
  const report = options.reportError ?? ((code: AuthReportCode) => console.error("Authentication failure:", code));
  const scopes = createRequestScopes();
  const credentials = new CredentialStore(database, config, clock);
  const outbox = createEmailOutbox({
    send: (job) => emailSender.sendAuthEmail(job),
    activate: (job) => credentials.activate(job),
    report,
  });

  // Business authorization reads the Session from PostgreSQL every time and never refreshes it.
  const readSession = (headers: Headers): Promise<AuthenticatedSession | null> =>
    native.api.getSession({ headers, query: { disableCookieCache: true, disableRefresh: true } });

  const native = betterAuth<BetterAuthOptions>(buildBetterAuthOptions({
    config,
    database,
    rateLimitPool: options.rateLimitPool,
    nativeRateLimitEnabled: options.nativeRateLimitEnabled ?? true,
    issuance: createIssuance(config, credentials, scopes),
    beforeHook: createBeforeHook({ config, credentials, readSession, clock }),
    onInternalError(error) {
      report("BETTER_AUTH_INTERNAL");
      const scope = scopes.current();
      if (scope) scope.internalError ??= error;
    },
  }));

  async function handle(request: Request): Promise<Response> {
    const route = resolveAuthRoute(new URL(request.url).pathname);
    if (!route) return authErrorResponse(new AuthFailure(404, "NOT_FOUND", "Authentication endpoint not found"));
    if (request.method !== route.method) return authErrorResponse(new AuthFailure(405, "METHOD_NOT_ALLOWED", "Method not allowed"));
    const origin = { method: request.method, origin: request.headers.get("origin"), fetchSite: request.headers.get("sec-fetch-site") };
    if (!isTrustedRequestOrigin(origin, config.trustedOrigins, { strict: true })) {
      return authErrorResponse(new AuthFailure(403, "INVALID_ORIGIN", "Untrusted request origin"));
    }

    return scopes.run(async (scope) => {
      try {
        // One transaction for the project checks and every Better Auth write; Better Auth's own
        // origin/CSRF/rate checks still run inside its handler. Only a 2xx/3xx answer commits.
        const response = await database.transaction(async () => {
          const result = await native.handler(request);
          if (scope.issuanceError) throw scope.issuanceError;
          if (result.status >= 500) throw new RejectedResponse(authErrorResponse(unexpectedFailure(scope.internalError).failure));
          if (result.status >= 400) throw new RejectedResponse(result);
          return result;
        });
        // Emails go out only after commit. The response stays generic: it does not reveal
        // whether an account exists or whether mail was sent.
        for (const job of scope.jobs) outbox.enqueue(job);
        return response;
      } catch (error) {
        if (error instanceof RejectedResponse) return error.response;
        if (error instanceof AuthFailure) return authErrorResponse(error);
        const { failure, report: code } = unexpectedFailure(error);
        report(code);
        return authErrorResponse(failure);
      }
    });
  }

  return {
    getSession: readSession,
    handler: handle,
    drainEmailQueue: () => outbox.drain(),
    close: () => outbox.drain(),
  };
}
