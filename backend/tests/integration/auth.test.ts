import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import type { AuthEmail, AuthEmailPurpose } from "../../src/integrations/email/types.js";
import {
  createAuthFixture,
  resetToken,
  sessionCookie,
  uniqueEmail,
  verificationUrl,
  type AuthFixture,
  type AuthFixtureOptions,
} from "../helpers/auth-fixture.js";

const initialPassword = "Fixture-initial-password-42!";
const replacementPassword = "Fixture-replacement-password-73!";

async function fixtureFor(context: TestContext, options: AuthFixtureOptions = {}): Promise<AuthFixture> {
  const fixture = await createAuthFixture(options);
  context.after(() => fixture.close());
  return fixture;
}

function latestEmail(fixture: AuthFixture, email: string, purpose: AuthEmailPurpose): AuthEmail {
  const message = [...fixture.emails].reverse().find(value => value.to === email && value.purpose === purpose);
  assert.ok(message, "The synthetic SMTP adapter must have accepted an email");
  return message;
}

async function codeOf(response: Response): Promise<string | undefined> {
  const body = await response.json() as { code?: string; error?: { code?: string } };
  return body.code ?? body.error?.code;
}

async function register(fixture: AuthFixture, email = uniqueEmail()) {
  const response = await fixture.request("/api/auth/sign-up/email", {
    body: { name: "Test Student", email, password: initialPassword },
  });
  assert.equal(response.status, 200, "Fixture registration must succeed");
  const body = await response.json() as { token?: unknown; user?: { id?: string; emailVerified?: boolean } };
  assert.equal(body.token === null, true, "Registration must return a null login token");
  assert.equal(body.user?.emailVerified, false);
  assert.equal(sessionCookie(response) === null, true, "Registration must not create a Session cookie");
  assert.equal(typeof body.user?.id, "string");
  return { email, userId: body.user!.id!, verification: latestEmail(fixture, email, "email_verification") };
}

async function verifiedAccount(fixture: AuthFixture, email = uniqueEmail()) {
  const account = await register(fixture, email);
  const response = await fixture.request(verificationUrl(account.verification, { callbackURL: null }));
  assert.equal(response.status, 200, "First verification must succeed");
  const cookie = sessionCookie(response);
  assert.ok(cookie, "First verification must establish a Session");
  return { ...account, cookie };
}

async function signIn(fixture: AuthFixture, email: string, password = initialPassword): Promise<Response> {
  return fixture.request("/api/auth/sign-in/email", { body: { email, password } });
}

async function requestReset(fixture: AuthFixture, email: string): Promise<AuthEmail> {
  const response = await fixture.request("/api/auth/request-password-reset", {
    body: { email, redirectTo: "http://localhost:5173/reset-password?source=email" },
  });
  assert.equal(response.status, 200);
  return latestEmail(fixture, email, "password_reset");
}

async function sessionIsPresent(fixture: AuthFixture, cookie: string): Promise<boolean> {
  const response = await fixture.request("/api/auth/get-session", { cookie });
  assert.equal(response.status, 200);
  return await response.json() !== null;
}

async function countSessions(fixture: AuthFixture, userId: string): Promise<number> {
  const result = await fixture.pool.query<{ count: string }>(
    'SELECT COUNT(*) AS count FROM auth_session WHERE "userId" = $1', [userId],
  );
  return Number(result.rows[0]!.count);
}

test("Authentication against isolated PostgreSQL databases", {
  skip: !process.env.TEST_DATABASE_URL,
  timeout: 180_000,
}, async (context) => {
  await context.test("registration has no Session and unverified password login is forbidden", async (t) => {
    const fixture = await fixtureFor(t);
    const account = await register(fixture);
    assert.equal(await countSessions(fixture, account.userId), 0);
    const anonymous = await fixture.request("/api/auth/get-session");
    assert.equal(anonymous.status, 200);
    assert.equal(await anonymous.json() === null, true);
    const login = await signIn(fixture, account.email);
    assert.equal(login.status, 403);
    assert.equal(await codeOf(login), "EMAIL_NOT_VERIFIED");
    assert.equal(await countSessions(fixture, account.userId), 0);
    const protectedOperation = await fixture.request("/api/auth/update-user", { body: { name: "Changed" } });
    assert.equal(protectedOperation.status, 401);
  });

  await context.test("first verification persists verified state and establishes an HttpOnly Session", async (t) => {
    const fixture = await fixtureFor(t);
    const account = await register(fixture);
    const response = await fixture.request(verificationUrl(account.verification, { callbackURL: null }));
    assert.equal(response.status, 200);
    const cookie = sessionCookie(response);
    assert.ok(cookie);
    assert.equal(response.headers.getSetCookie().some(value => /httponly/i.test(value)), true);
    assert.equal(response.headers.getSetCookie().some(value => /samesite=lax/i.test(value)), true);
    const session = await fixture.authentication.getSession(new Headers({ cookie }));
    assert.equal(session?.user.emailVerified, true);
    assert.equal(session?.user.id === account.userId, true);
    assert.equal(await countSessions(fixture, account.userId), 1);
    const persisted = await fixture.pool.query<{ emailVerified: boolean }>(
      'SELECT "emailVerified" FROM auth_user WHERE id = $1', [account.userId],
    );
    assert.equal(persisted.rows[0]!.emailVerified, true);
  });

  await context.test("untrusted callbacks fail before mutation; trusted verification redirect preserves query parameters", async (t) => {
    const fixture = await fixtureFor(t);
    const account = await register(fixture);
    for (const callbackURL of [
      "https://attacker.example.test/steal",
      "//attacker.example.test/steal",
      "/%2Fattacker.example.test/steal",
      "http://localhost:5173.attacker.example.test/steal",
    ]) {
      const response = await fixture.request(verificationUrl(account.verification, { callbackURL }));
      assert.equal(response.status, 403);
      assert.equal(response.headers.has("location"), false);
    }
    assert.equal(await countSessions(fixture, account.userId), 0);
    const callbackURL = "http://localhost:5173/email-verified?source=mail";
    const verified = await fixture.request(verificationUrl(account.verification, { callbackURL }));
    assert.equal(verified.status, 302);
    const location = new URL(verified.headers.get("location")!, fixture.config.baseUrl);
    assert.equal(location.origin, "http://localhost:5173");
    assert.equal(location.pathname, "/email-verified");
    assert.equal(location.searchParams.get("source"), "mail");
    assert.equal(location.searchParams.has("error"), false);
    const cookie = sessionCookie(verified);
    assert.ok(cookie);
    assert.equal(await sessionIsPresent(fixture, cookie), true);
  });

  await context.test("credential replacement is scoped to its user and purpose", async (t) => {
    const fixture = await fixtureFor(t);
    const first = await register(fixture);
    const other = await register(fixture);
    const reset = await requestReset(fixture, first.email);
    const resent = await fixture.request("/api/auth/send-verification-email", { body: { email: first.email } });
    assert.equal(resent.status, 200);
    const replacement = latestEmail(fixture, first.email, "email_verification");
    assert.equal(replacement.url !== first.verification.url, true, "Every issuance needs a fresh credential");
    const stale = await fixture.request(verificationUrl(first.verification, { callbackURL: null }));
    assert.equal(stale.status, 401);
    assert.equal(await codeOf(stale), "INVALID_TOKEN");
    const staleRedirect = await fixture.request(verificationUrl(first.verification, { callbackURL: "/email-verified?source=old" }));
    assert.equal(staleRedirect.status, 302);
    const staleLocation = new URL(staleRedirect.headers.get("location")!, fixture.config.baseUrl);
    assert.equal(staleLocation.searchParams.get("error"), "INVALID_TOKEN");
    assert.equal(staleLocation.searchParams.get("source"), "old");
    assert.equal((await fixture.request(verificationUrl(other.verification, { callbackURL: null }))).status, 200);
    assert.equal((await fixture.request(verificationUrl(replacement, { callbackURL: null }))).status, 200);
    const resetCallback = await fixture.request(reset.url);
    assert.equal(resetCallback.status, 302);
    assert.equal(new URL(resetCallback.headers.get("location")!, fixture.config.baseUrl).searchParams.has("token"), true);
  });

  await context.test("verification rejects the exact 900-second expiry without changing verification or creating a Session", async (t) => {
    const fixture = await fixtureFor(t);
    const account = await register(fixture);
    fixture.clock.set(account.verification.expiresAt);
    const expired = await fixture.request(verificationUrl(account.verification, { callbackURL: null }));
    assert.equal(expired.status, 401);
    assert.equal(await codeOf(expired), "TOKEN_EXPIRED");
    const persisted = await fixture.pool.query<{ emailVerified: boolean }>(
      'SELECT "emailVerified" FROM auth_user WHERE id = $1', [account.userId],
    );
    assert.equal(persisted.rows[0]!.emailVerified, false);
    assert.equal(await countSessions(fixture, account.userId), 0);
  });

  await context.test("SMTP failure reserves ordering but preserves the old active verification and reset links", async (t) => {
    const fixture = await fixtureFor(t);
    const account = await register(fixture);
    fixture.emailSender.failNext();
    const accepted = await fixture.request("/api/auth/send-verification-email", { body: { email: account.email } });
    assert.equal(accepted.status, 200);
    const state = await fixture.pool.query<{ sequence: string; active_sequence: string }>(
      "SELECT sequence, active_sequence FROM auth_credential_state WHERE user_id = $1 AND purpose = 'email_verification'", [account.userId],
    );
    assert.equal(state.rows[0]!.sequence, "2");
    assert.equal(state.rows[0]!.active_sequence, "1");
    assert.equal(fixture.errors.includes("AUTH_EMAIL_DELIVERY_OR_ACTIVATION_FAILED"), true);
    const verified = await fixture.request(verificationUrl(account.verification, { callbackURL: null }));
    assert.equal(verified.status, 200);
    const reset = await requestReset(fixture, account.email);
    fixture.emailSender.failNext();
    const failedResend = await fixture.request("/api/auth/request-password-reset", {
      body: { email: account.email, redirectTo: "http://localhost:5173/reset-password" },
    });
    assert.equal(failedResend.status, 200);
    const stillValid = await fixture.request(reset.url);
    assert.equal(stillValid.status, 302);
    assert.equal(new URL(stillValid.headers.get("location")!, fixture.config.baseUrl).searchParams.has("token"), true);
    const resetResponse = await fixture.request("/api/auth/reset-password", {
      body: { token: resetToken(reset), newPassword: replacementPassword },
    });
    assert.equal(resetResponse.status, 200);
  });

  await context.test("reset GET is read-only, and a replacement between GET and POST invalidates the old token", async (t) => {
    const fixture = await fixtureFor(t);
    const account = await verifiedAccount(fixture);
    const reset = await requestReset(fixture, account.email);
    for (let index = 0; index < 2; index += 1) {
      const callback = await fixture.request(reset.url);
      assert.equal(callback.status, 302);
      const location = new URL(callback.headers.get("location")!, fixture.config.baseUrl);
      assert.equal(location.searchParams.get("token") === resetToken(reset), true);
      assert.equal(location.searchParams.get("source"), "email");
    }
    const nativeRecord = await fixture.pool.query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM auth_verification WHERE identifier = $1", [`reset-password:${resetToken(reset)}`],
    );
    assert.equal(nativeRecord.rows[0]!.count, "1");
    assert.equal(await sessionIsPresent(fixture, account.cookie), true);
    const newReset = await requestReset(fixture, account.email);
    assert.equal(newReset.url !== reset.url, true);
    const rejected = await fixture.request("/api/auth/reset-password", {
      body: { token: resetToken(reset), newPassword: replacementPassword },
    });
    assert.equal(rejected.status, 400);
    assert.equal(await sessionIsPresent(fixture, account.cookie), true);
    assert.equal((await signIn(fixture, account.email)).status, 200);
    const missingCallback = new URL(newReset.url);
    missingCallback.searchParams.delete("callbackURL");
    assert.equal((await fixture.request(missingCallback.href)).status, 400);
    missingCallback.searchParams.set("callbackURL", "");
    const emptyCallback = await fixture.request(missingCallback.href);
    assert.equal(emptyCallback.status, 302);
    const emptyDestination = new URL(emptyCallback.headers.get("location")!, fixture.config.baseUrl);
    assert.equal(emptyDestination.pathname, "/api/auth/error");
    assert.equal(emptyDestination.searchParams.get("error"), "INVALID_TOKEN");
  });

  await context.test("expired reset callbacks and submissions cannot mutate password or Sessions", async (t) => {
    const fixture = await fixtureFor(t);
    const account = await verifiedAccount(fixture);
    const reset = await requestReset(fixture, account.email);
    fixture.clock.set(reset.expiresAt);
    const callback = await fixture.request(reset.url);
    assert.equal(callback.status, 302);
    const destination = new URL(callback.headers.get("location")!, fixture.config.baseUrl);
    assert.equal(destination.searchParams.get("error"), "INVALID_TOKEN");
    assert.equal(destination.searchParams.has("token"), false);
    const resetResponse = await fixture.request("/api/auth/reset-password", {
      body: { token: resetToken(reset), newPassword: replacementPassword },
    });
    assert.equal(resetResponse.status, 400);
    assert.equal(await sessionIsPresent(fixture, account.cookie), true);
    assert.equal((await signIn(fixture, account.email)).status, 200);
  });

  await context.test("concurrent reset consumes once, revokes every old device, and does not auto-login", async (t) => {
    const fixture = await fixtureFor(t);
    const account = await verifiedAccount(fixture);
    const second = await signIn(fixture, account.email);
    const third = await signIn(fixture, account.email);
    const oldCookies = [account.cookie, sessionCookie(second), sessionCookie(third)];
    assert.equal(oldCookies.every(value => Boolean(value)), true);
    assert.equal(await countSessions(fixture, account.userId), 3);
    const reset = await requestReset(fixture, account.email);
    const responses = await Promise.all([0, 1].map(() => fixture.request("/api/auth/reset-password", {
      body: { token: resetToken(reset), newPassword: replacementPassword },
    })));
    assert.equal(responses.filter(value => value.status === 200).length, 1);
    assert.equal(responses.filter(value => value.status === 400).length, 1);
    assert.equal(responses.every(value => sessionCookie(value) === null), true);
    assert.equal(await countSessions(fixture, account.userId), 0);
    for (const cookie of oldCookies) assert.equal(await sessionIsPresent(fixture, cookie!), false);
    assert.equal((await signIn(fixture, account.email)).status, 401);
    const freshLogin = await signIn(fixture, account.email, replacementPassword);
    assert.equal(freshLogin.status, 200);
    const freshCookie = sessionCookie(freshLogin);
    assert.ok(freshCookie);
    const replay = await fixture.request("/api/auth/reset-password", {
      body: { token: resetToken(reset), newPassword: initialPassword },
    });
    assert.equal(replay.status, 400);
    assert.equal(await sessionIsPresent(fixture, freshCookie), true);
  });

  for (const target of ["consumption", "password", "sessions"] as const) {
    await context.test(`PostgreSQL ${target} failure rolls back reset consumption, password and Session changes`, async (t) => {
      const fixture = await fixtureFor(t);
      const account = await verifiedAccount(fixture);
      const reset = await requestReset(fixture, account.email);
      const before = await fixture.pool.query<{ password: string }>(
        'SELECT password FROM auth_account WHERE "userId" = $1 AND "providerId" = $2', [account.userId, "credential"],
      );
      const table = target === "consumption" ? "auth_verification" : target === "password" ? "auth_account" : "auth_session";
      const event = target === "password" ? "UPDATE OF password" : "DELETE";
      await fixture.pool.query(`
        CREATE FUNCTION auth_test_injected_failure() RETURNS TRIGGER LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'Injected authentication transaction failure'; END; $$;
        CREATE TRIGGER auth_test_failure BEFORE ${event} ON ${table}
          FOR EACH ROW EXECUTE FUNCTION auth_test_injected_failure();
      `);
      const rejected = await fixture.request("/api/auth/reset-password", {
        body: { token: resetToken(reset), newPassword: replacementPassword },
      });
      assert.equal(rejected.status >= 400, true);
      const after = await fixture.pool.query<{ password: string }>(
        'SELECT password FROM auth_account WHERE "userId" = $1 AND "providerId" = $2', [account.userId, "credential"],
      );
      assert.equal(after.rows[0]!.password === before.rows[0]!.password, true, "The password write must roll back");
      assert.equal(await sessionIsPresent(fixture, account.cookie), true);
      const record = await fixture.pool.query<{ count: string }>(
        "SELECT COUNT(*) AS count FROM auth_verification WHERE identifier = $1", [`reset-password:${resetToken(reset)}`],
      );
      assert.equal(record.rows[0]!.count, "1");
      await fixture.pool.query(`DROP TRIGGER auth_test_failure ON ${table}; DROP FUNCTION auth_test_injected_failure();`);
      const retried = await fixture.request("/api/auth/reset-password", {
        body: { token: resetToken(reset), newPassword: replacementPassword },
      });
      assert.equal(retried.status, 200, "Rolled-back credentials must remain usable for retry");
      assert.equal(await sessionIsPresent(fixture, account.cookie), false);
    });
  }

  await context.test("cooldown applies equally to existing and unknown addresses", async (t) => {
    const fixture = await fixtureFor(t, { config: { emailCooldownSeconds: 60 } });
    const account = await register(fixture);
    const unknown = uniqueEmail();
    assert.equal((await fixture.request("/api/auth/send-verification-email", { body: { email: unknown } })).status, 200);
    for (const email of [account.email, unknown]) {
      const response = await fixture.request("/api/auth/send-verification-email", { body: { email } });
      assert.equal(response.status, 429);
      assert.equal(await codeOf(response), "EMAIL_COOLDOWN");
      assert.equal(Number(response.headers.get("retry-after")) > 0, true);
    }
    fixture.clock.advanceSeconds(61);
    for (const email of [account.email, unknown]) {
      assert.equal((await fixture.request("/api/auth/send-verification-email", { body: { email } })).status, 200);
    }
    assert.equal(fixture.emails.some(value => value.to === unknown), false);
  });

  await context.test("window limits apply equally to unknown addresses and isolate verification from reset", async (t) => {
    const fixture = await fixtureFor(t, { config: { emailMaxPerWindow: 2 } });
    const account = await register(fixture);
    const unknown = uniqueEmail();
    assert.equal((await fixture.request("/api/auth/send-verification-email", { body: { email: unknown } })).status, 200);
    for (const email of [account.email, unknown]) {
      assert.equal((await fixture.request("/api/auth/send-verification-email", { body: { email } })).status, 200);
      const limited = await fixture.request("/api/auth/send-verification-email", { body: { email } });
      assert.equal(limited.status, 429);
      assert.equal(await codeOf(limited), "EMAIL_RATE_LIMIT");
      const resetRequest = await fixture.request("/api/auth/request-password-reset", {
        body: { email, redirectTo: "http://localhost:5173/reset-password" },
      });
      assert.equal(resetRequest.status, 200);
    }
    assert.equal(fixture.emails.some(value => value.to === unknown), false);
    fixture.clock.advanceSeconds(901);
    assert.equal((await fixture.request("/api/auth/send-verification-email", { body: { email: unknown } })).status, 200);
  });

  await context.test("Session listing, ownership-scoped revocation, profile updates, and logout use real server state", async (t) => {
    const fixture = await fixtureFor(t);
    const account = await verifiedAccount(fixture);
    const other = await verifiedAccount(fixture);
    const secondLogin = await signIn(fixture, account.email);
    const secondCookie = sessionCookie(secondLogin);
    assert.ok(secondCookie);
    const ownSession = await fixture.authentication.getSession(new Headers({ cookie: secondCookie }));
    assert.ok(ownSession);
    const crossUser = await fixture.request("/api/auth/revoke-session", {
      cookie: other.cookie,
      body: { token: ownSession.session.token },
    });
    // Native Better Auth acknowledges generically to avoid exposing whether
    // another user's Session exists; the ownership guarantee is no revocation.
    assert.equal(crossUser.status, 200);
    assert.equal(await sessionIsPresent(fixture, secondCookie), true);
    const listed = await fixture.request("/api/auth/list-sessions", { cookie: account.cookie });
    assert.equal(listed.status, 200);
    const sessions = await listed.json() as unknown[];
    assert.equal(sessions.length, 2);
    const updated = await fixture.request("/api/auth/update-user", { cookie: account.cookie, body: { name: "Updated Student" } });
    assert.equal(updated.status, 200);
    assert.equal((await fixture.authentication.getSession(new Headers({ cookie: account.cookie })))?.user.name, "Updated Student");
    const revoked = await fixture.request("/api/auth/revoke-session", {
      cookie: account.cookie,
      body: { token: ownSession.session.token },
    });
    assert.equal(revoked.status, 200);
    assert.equal(await sessionIsPresent(fixture, secondCookie), false);
    assert.equal(await sessionIsPresent(fixture, other.cookie), true);
    const logout = await fixture.request("/api/auth/sign-out", { method: "POST", body: {}, cookie: account.cookie });
    assert.equal(logout.status, 200);
    assert.equal(await sessionIsPresent(fixture, account.cookie), false);
    assert.equal(await sessionIsPresent(fixture, other.cookie), true);
  });

  await context.test("authenticated password change rejects the old password and accepts the new one", async (t) => {
    const fixture = await fixtureFor(t);
    const account = await verifiedAccount(fixture);
    const changed = await fixture.request("/api/auth/change-password", {
      cookie: account.cookie,
      body: {
        currentPassword: initialPassword,
        newPassword: replacementPassword,
      },
    });
    assert.equal(changed.status, 200);
    assert.equal((await signIn(fixture, account.email, initialPassword)).status, 401);
    const newLogin = await signIn(fixture, account.email, replacementPassword);
    assert.equal(newLogin.status, 200);
    const cookie = sessionCookie(newLogin);
    assert.ok(cookie);
    assert.equal(await sessionIsPresent(fixture, cookie), true);
  });

  await context.test("HTTPS configuration sets Secure cookies and native origin checks block hostile signup", async (t) => {
    const fixture = await fixtureFor(t, {
      config: {
        baseUrl: "https://auth.example.test",
        trustedOrigins: ["https://auth.example.test", "https://frontend.example.test"],
        secureCookies: true,
      },
    });
    const hostile = await fixture.request("/api/auth/sign-up/email", {
      origin: "https://attacker.example.test",
      body: { name: "Test Student", email: uniqueEmail(), password: initialPassword },
    });
    assert.equal(hostile.status, 403);
    assert.equal(fixture.emails.length, 0);
    const account = await register(fixture);
    const verified = await fixture.request(verificationUrl(account.verification, { callbackURL: null }));
    assert.equal(verified.status, 200);
    const cookie = sessionCookie(verified);
    assert.ok(cookie);
    assert.equal(verified.headers.getSetCookie().some(value => /;\s*secure(?:;|$)/i.test(value)), true);
    assert.equal(verified.headers.getSetCookie().some(value => /;\s*httponly(?:;|$)/i.test(value)), true);
  });
});
