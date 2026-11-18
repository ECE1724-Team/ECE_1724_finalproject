import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test, { type TestContext } from "node:test";
import { createSmtpEmailSender } from "../../src/integrations/email/smtp.js";
import type { AuthEmail } from "../../src/integrations/email/types.js";
import { createAuthFixture, uniqueEmail, verificationUrl, type AuthFixture } from "../helpers/auth-fixture.js";
import { createPausedSmtpServer, smtpDeadline, type PausedSmtpServer } from "../helpers/smtp-server.js";

interface ActiveCredential {
  current_token_digest: string;
  current_issuance_id: string;
  active_sequence: string;
}

function verificationDigest(message: AuthEmail): string {
  const token = new URL(message.url).searchParams.get("token");
  if (!token || message.purpose !== "email_verification") {
    throw new Error("Expected a queued email verification credential");
  }
  return createHash("sha256").update(token).digest("hex");
}

async function activeCredential(fixture: AuthFixture, userId: string): Promise<ActiveCredential> {
  const result = await fixture.pool.query<ActiveCredential>(
    `SELECT current_token_digest, current_issuance_id, active_sequence
     FROM auth_credential_state WHERE user_id = $1 AND purpose = 'email_verification'`,
    [userId],
  );
  assert.equal(result.rowCount, 1);
  return result.rows[0]!;
}

async function setup(t: TestContext): Promise<{
  fixture: AuthFixture;
  smtp: PausedSmtpServer;
  userId: string;
  email: string;
  originalEmail: AuthEmail;
  original: ActiveCredential;
  queued(): AuthEmail;
}> {
  const smtp = await createPausedSmtpServer();
  let fixture: AuthFixture | undefined;
  t.after(async () => {
    // Closing SMTP first also releases a pending sender if an assertion failed.
    await smtp.close();
    if (fixture) await smtpDeadline(fixture.close(), "The authentication fixture did not close");
  });
  fixture = await createAuthFixture({ config: { emailCooldownSeconds: 0, emailMaxPerWindow: 100 } });
  const email = uniqueEmail();
  const signup = await fixture.request("/api/auth/sign-up/email", {
    body: { name: "SMTP Acceptance", email, password: "A-valid-password-for-SMTP-31!" },
  });
  assert.equal(signup.status, 200);
  const { user } = await signup.json() as { user: { id: string } };
  const originalEmail = fixture.emails.at(-1);
  assert.ok(originalEmail, "The original signup email must have been accepted");
  const original = await activeCredential(fixture, user.id);
  assert.equal(original.current_token_digest, verificationDigest(originalEmail));

  const sender = createSmtpEmailSender({
    host: "127.0.0.1",
    port: smtp.port,
    secure: false,
    from: "JobFlow Tests <no-reply@example.test>",
  });
  let captured: AuthEmail | undefined;
  fixture.emailSender.sendAuthEmail = async (message) => {
    captured = { ...message, expiresAt: new Date(message.expiresAt) };
    await sender.sendAuthEmail(message);
  };

  return {
    fixture,
    smtp,
    userId: user.id,
    email,
    originalEmail,
    original,
    queued() {
      if (!captured) throw new Error("The resend credential was not queued");
      return captured;
    },
  };
}

test("a verification replacement activates only after the real SMTP DATA 250 response", { timeout: 25_000 }, async (t) => {
  const context = await setup(t);
  const { fixture, smtp, original, originalEmail, userId, email } = context;
  const response = await fixture.request("/api/auth/send-verification-email", {
    body: { email },
    drainEmails: false,
  });
  assert.equal(response.status, 200);
  await smtp.waitForData();
  assert.equal(smtp.receivedMessages, 1);
  assert.equal(smtp.acceptedMessages, 0);
  const queued = context.queued();
  const replacementDigest = verificationDigest(queued);
  assert.notEqual(replacementDigest, original.current_token_digest);

  // DATA arriving at an SMTP server is not acceptance. The active link and its
  // issuance identity must remain unchanged while that final reply is pending.
  assert.deepEqual(await activeCredential(fixture, userId), original);
  const premature = await fixture.request(verificationUrl(queued, { callbackURL: null }), { drainEmails: false });
  assert.equal(premature.status, 401);
  assert.equal((await premature.json() as { code: string }).code, "INVALID_TOKEN");
  assert.deepEqual(await activeCredential(fixture, userId), original);

  smtp.respond("accept");
  await smtpDeadline(fixture.authentication.drainEmailQueue(), "Accepted SMTP delivery did not finish activation");
  const active = await activeCredential(fixture, userId);
  assert.equal(smtp.acceptedMessages, 1);
  assert.equal(active.current_token_digest, replacementDigest);
  assert.notEqual(active.current_issuance_id, original.current_issuance_id);
  assert.ok(BigInt(active.active_sequence) > BigInt(original.active_sequence));
  assert.deepEqual(fixture.errors, []);

  const superseded = await fixture.request(verificationUrl(originalEmail, { callbackURL: null }));
  assert.equal(superseded.status, 401);
  assert.equal((await superseded.json() as { code: string }).code, "INVALID_TOKEN");
  const verified = await fixture.request(verificationUrl(queued, { callbackURL: null }));
  assert.equal(verified.status, 200);
});

for (const outcome of ["reject", "disconnect"] as const) {
  test(`SMTP ${outcome === "reject" ? "550 rejection" : "disconnect before acceptance"} preserves the previous active link`, { timeout: 25_000 }, async (t) => {
    const context = await setup(t);
    const { fixture, smtp, original, originalEmail, userId, email } = context;
    const response = await fixture.request("/api/auth/send-verification-email", {
      body: { email },
      drainEmails: false,
    });
    assert.equal(response.status, 200);
    await smtp.waitForData();
    assert.deepEqual(await activeCredential(fixture, userId), original);
    const queued = context.queued();

    smtp.respond(outcome);
    await smtpDeadline(fixture.authentication.drainEmailQueue(), "Rejected SMTP delivery did not settle");
    assert.equal(smtp.acceptedMessages, 0);
    assert.deepEqual(await activeCredential(fixture, userId), original);
    assert.deepEqual(fixture.errors, ["AUTH_EMAIL_DELIVERY_FAILED"]);

    const rejected = await fixture.request(verificationUrl(queued, { callbackURL: null }));
    assert.equal(rejected.status, 401);
    assert.equal((await rejected.json() as { code: string }).code, "INVALID_TOKEN");
    const stillUsable = await fixture.request(verificationUrl(originalEmail, { callbackURL: null }));
    assert.equal(stillUsable.status, 200);
  });
}
