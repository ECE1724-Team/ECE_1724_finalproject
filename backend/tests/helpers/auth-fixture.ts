import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { runner } from "node-pg-migrate";
import type { AuthConfig } from "../../src/config/env.js";
import { Database } from "../../src/db/transaction.js";
import type { AuthEmail, EmailSender } from "../../src/integrations/email/types.js";
import { createAuthentication, type Authentication } from "../../src/modules/auth/auth.js";

export class RecordingEmailSender implements EmailSender {
  readonly messages: AuthEmail[] = [];
  readonly attempts: AuthEmail[] = [];
  private failuresRemaining = 0;

  failNext(count = 1): void {
    this.failuresRemaining = count;
  }

  async sendAuthEmail(message: AuthEmail): Promise<void> {
    const copy = { ...message, expiresAt: new Date(message.expiresAt) };
    this.attempts.push(copy);
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new Error("Synthetic SMTP rejection");
    }
    this.messages.push(copy);
  }
}

export interface AuthRequestOptions {
  method?: string;
  body?: unknown;
  cookie?: string;
  origin?: string;
  headers?: HeadersInit;
  drainEmails?: boolean;
}

export interface AuthFixtureOptions {
  config?: Partial<AuthConfig>;
  nativeRateLimitEnabled?: boolean;
}

export interface AuthFixture {
  authentication: Authentication;
  database: Database;
  pool: pg.Pool;
  config: AuthConfig;
  emailSender: RecordingEmailSender;
  emails: AuthEmail[];
  errors: string[];
  request(path: string, options?: AuthRequestOptions): Promise<Response>;
  clock: {
    now(): Date;
    set(value: Date): void;
    advanceSeconds(seconds: number): void;
  };
  close(): Promise<void>;
}

/** Extract only the Session cookie; never print it in test diagnostics. */
export function sessionCookie(response: Response): string | null {
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(";", 1)[0]!;
    const separator = pair.indexOf("=");
    if (pair.slice(0, separator).endsWith(".session_token") && pair.slice(separator + 1)) {
      return pair;
    }
  }
  return null;
}

/** null removes the callback so verification returns JSON instead of redirecting. */
export function verificationUrl(
  email: AuthEmail,
  options: { callbackURL?: string | null } = {},
): string {
  const url = new URL(email.url);
  if (options.callbackURL === null) url.searchParams.delete("callbackURL");
  else if (options.callbackURL !== undefined) url.searchParams.set("callbackURL", options.callbackURL);
  return url.href;
}

export function resetToken(email: AuthEmail): string {
  const url = new URL(email.url);
  const token = url.pathname.split("/").at(-1);
  if (!token || email.purpose !== "password_reset") throw new Error("Expected a reset email");
  return decodeURIComponent(token);
}

/** backend/migrations, found from either the source tree or the compiled dist/tests tree. */
function migrationsDirectory(): string {
  for (let directory = __dirname; ; directory = path.dirname(directory)) {
    const candidate = path.join(directory, "migrations");
    if (existsSync(path.join(candidate, "20261111000100_auth_core.cjs"))) return candidate;
    if (path.dirname(directory) === directory) throw new Error("backend/migrations was not found");
  }
}

/**
 * TEST_DATABASE_URL is an administration connection, never the test's target DB.
 * Each fixture creates and drops only its own random, hard-coded-prefix database.
 */
export async function createAuthFixture(options: AuthFixtureOptions = {}): Promise<AuthFixture> {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) throw new Error("TEST_DATABASE_URL is required for PostgreSQL integration tests");
  const adminUrl = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(adminUrl.protocol)) throw new Error("TEST_DATABASE_URL must be a PostgreSQL URL");

  const databaseName = `jobflow_auth_test_${randomBytes(12).toString("hex")}`;
  if (!/^jobflow_auth_test_[a-f0-9]{24}$/.test(databaseName)) throw new Error("Invalid isolated test database name");
  const admin = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 });
  const testUrl = new URL(adminUrl);
  testUrl.pathname = `/${databaseName}`;
  const pool = new pg.Pool({ connectionString: testUrl.href, max: 10, connectionTimeoutMillis: 5000 });
  const database = new Database(pool);
  const emailSender = new RecordingEmailSender();
  const errors: string[] = [];
  const config: AuthConfig = {
    baseUrl: "http://localhost:3000",
    secret: randomBytes(48).toString("base64url"),
    trustedOrigins: ["http://localhost:3000", "http://localhost:5173"],
    sessionLifetimeSeconds: 604800,
    emailCooldownSeconds: 0,
    emailWindowSeconds: 900,
    emailMaxPerWindow: 100,
    secureCookies: false,
    cookieSameSite: "lax",
    ...options.config,
  };
  let now = new Date();
  let created = false;
  let closed = false;
  let authentication: Authentication | undefined;

  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    try {
      try {
        if (authentication) {
          await authentication.drainEmailQueue();
          await authentication.close();
        }
      } finally {
        await pool.end();
      }
      if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
    } finally {
      await admin.end();
    }
  };

  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    await runner({
      databaseUrl: testUrl.href,
      dir: migrationsDirectory(),
      migrationsTable: "pgmigrations",
      direction: "up",
      count: Infinity,
      logger: { debug() {}, info() {}, warn() {}, error() {} },
    });
    authentication = createAuthentication({
      database,
      config,
      emailSender,
      nativeRateLimitEnabled: options.nativeRateLimitEnabled ?? false,
      clock: () => new Date(now),
      reportError: (code) => { errors.push(code); },
    });
    const runtime = authentication;
    return {
      authentication: runtime,
      database,
      pool,
      config,
      emailSender,
      emails: emailSender.messages,
      errors,
      clock: {
        now: () => new Date(now),
        set(value) { now = new Date(value); },
        advanceSeconds(seconds) { now = new Date(now.getTime() + seconds * 1000); },
      },
      async request(path, requestOptions = {}) {
        const headers = new Headers(requestOptions.headers);
        if (!headers.has("content-type")) headers.set("content-type", "application/json");
        if (!headers.has("origin")) headers.set("origin", requestOptions.origin ?? config.trustedOrigins.find(value => value !== config.baseUrl) ?? config.baseUrl);
        if (!headers.has("x-jobflow-client-ip")) headers.set("x-jobflow-client-ip", "127.0.0.1");
        if (requestOptions.cookie) headers.set("cookie", requestOptions.cookie);
        const response = await runtime.handler(new Request(new URL(path, config.baseUrl), {
          method: requestOptions.method ?? (requestOptions.body === undefined ? "GET" : "POST"),
          headers,
          ...(requestOptions.body === undefined ? {} : { body: JSON.stringify(requestOptions.body) }),
        }));
        if (requestOptions.drainEmails !== false) await runtime.drainEmailQueue();
        return response;
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

/** Fake identities may be used as input, but only native registration creates users. */
export function uniqueEmail(): string {
  return `student-${randomUUID()}@example.test`;
}
