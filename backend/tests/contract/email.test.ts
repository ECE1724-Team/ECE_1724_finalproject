import assert from "node:assert/strict";
import { test } from "node:test";
import nodemailer, { type SendMailOptions } from "nodemailer";
import {
  AuthEmailDeliveryError,
  createSmtpEmailSender,
  type SmtpMailTransport,
} from "../../src/integrations/email/smtp.js";
import type {
  AuthEmail,
  SmtpEmailConfig,
} from "../../src/integrations/email/types.js";

const config: SmtpEmailConfig = {
  host: "smtp.example.test",
  port: 587,
  secure: false,
  from: "JobFlow AI <no-reply@example.test>",
};

const message: AuthEmail = {
  to: "student@example.test",
  url: "https://jobflow.example.test/api/auth/verify-email?token=test-secret&callbackURL=%2F",
  purpose: "email_verification",
  expiresAt: new Date("2026-11-11T18:15:00.000Z"),
};

function captureTransport(): {
  transport: SmtpMailTransport;
  sent: SendMailOptions[];
} {
  const sent: SendMailOptions[] = [];
  return {
    transport: {
      async sendMail(options) {
        sent.push(options);
        return { accepted: [message.to] };
      },
    },
    sent,
  };
}

test("verification email contains the original link in text and an escaped HTML link", async () => {
  const { transport, sent } = captureTransport();
  const sender = createSmtpEmailSender(config, transport);

  await sender.sendAuthEmail(message);

  assert.equal(sent.length, 1);
  const email = sent[0]!;
  assert.equal(email.from, config.from);
  assert.deepEqual(email.to, { name: "", address: message.to });
  assert.equal(email.subject, "Verify your JobFlow AI email");
  assert.equal(typeof email.text, "string");
  assert.ok((email.text as string).includes(message.url));
  assert.ok((email.text as string).includes(message.expiresAt.toISOString()));
  assert.ok((email.html as string).includes("&amp;callbackURL=%2F"));
  assert.ok(!(email.html as string).includes(message.url));
  assert.equal(email.disableFileAccess, true);
  assert.equal(email.disableUrlAccess, true);
});

test("password-reset email uses its own action and retains the provided expiry", async () => {
  const { transport, sent } = captureTransport();
  const sender = createSmtpEmailSender(config, transport);
  const resetUrl = "https://jobflow.example.test/api/auth/reset-password/one-time-token?callbackURL=%2Freset";

  await sender.sendAuthEmail({ ...message, purpose: "password_reset", url: resetUrl });

  const email = sent[0]!;
  assert.equal(email.subject, "Reset your JobFlow AI password");
  assert.ok((email.text as string).includes(resetUrl));
  assert.ok((email.html as string).includes(">Reset password</a>"));
  assert.ok((email.text as string).includes("2026-11-11T18:15:00.000Z"));
});

test("HTML escapes all special characters without altering the plain-text credential URL", async () => {
  const { transport, sent } = captureTransport();
  const sender = createSmtpEmailSender(config, transport);
  const url = "https://jobflow.example.test/verify?token=abc&value=\"<tag>'";

  await sender.sendAuthEmail({ ...message, url });

  const email = sent[0]!;
  assert.ok((email.text as string).includes(url));
  assert.ok((email.html as string).includes("&amp;value=&quot;&lt;tag&gt;&#39;"));
  assert.ok(!(email.html as string).includes("<tag>"));
});

test("Nodemailer produces a multipart email locally without connecting to an SMTP server", async () => {
  const localTransport = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    newline: "unix",
  });
  let rawMessage: Buffer | undefined;
  const sender = createSmtpEmailSender(config, {
    async sendMail(options) {
      const result = await localTransport.sendMail(options);
      assert.ok(Buffer.isBuffer(result.message));
      rawMessage = result.message;
      return result;
    },
  });

  await sender.sendAuthEmail(message);

  assert.ok(rawMessage);
  const mime = rawMessage.toString("utf8");
  assert.match(mime, /Subject: Verify your JobFlow AI email/);
  assert.match(mime, /To: student@example\.test/);
  assert.match(mime, /Content-Type: multipart\/alternative/);
  assert.match(mime, /Content-Type: text\/plain/);
  assert.match(mime, /Content-Type: text\/html/);
});

test("invalid recipients, unsafe links and invalid expiry never reach the transport", async () => {
  const { transport, sent } = captureTransport();
  const sender = createSmtpEmailSender(config, transport);

  for (const invalid of [
    { ...message, to: "student@example.test,attacker@example.test" },
    { ...message, to: "student@example.test\r\nBcc:attacker@example.test" },
    { ...message, url: "javascript:alert(1)" },
    { ...message, url: "file:///etc/passwd" },
    { ...message, url: "https://user:secret@jobflow.example.test/verify" },
    { ...message, url: "not-a-url-with-a-secret" },
    { ...message, expiresAt: new Date("invalid") },
  ]) {
    await assert.rejects(sender.sendAuthEmail(invalid), TypeError);
  }
  assert.equal(sent.length, 0);
});

test("SMTP failures become safe errors that do not retain credentials or transport details", async () => {
  const transport: SmtpMailTransport = {
    async sendMail() {
      throw new Error(`SMTP password=private-password; message URL=${message.url}`);
    },
  };
  const sender = createSmtpEmailSender(config, transport);

  await assert.rejects(sender.sendAuthEmail(message), (error: unknown) => {
    assert.ok(error instanceof AuthEmailDeliveryError);
    assert.equal(error.code, "AUTH_EMAIL_DELIVERY_FAILED");
    assert.ok(!String(error).includes("test-secret"));
    assert.ok(!String(error).includes("private-password"));
    assert.equal("cause" in error, false);
    return true;
  });
});

test("SMTP configuration rejects incomplete credentials and invalid connection settings", () => {
  const { transport } = captureTransport();

  assert.throws(() => createSmtpEmailSender({ ...config, user: "smtp-user" }, transport), TypeError);
  assert.throws(() => createSmtpEmailSender({ ...config, password: "secret" }, transport), TypeError);
  assert.throws(() => createSmtpEmailSender({ ...config, port: 0 }, transport), TypeError);
  assert.throws(() => createSmtpEmailSender({ ...config, port: 65536 }, transport), TypeError);
  assert.throws(() => createSmtpEmailSender({ ...config, host: "" }, transport), TypeError);
  assert.throws(() => createSmtpEmailSender({ ...config, from: "bad\r\nBcc:attack@example.test" }, transport), TypeError);
});
