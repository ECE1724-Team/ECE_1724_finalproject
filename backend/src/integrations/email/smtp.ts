import nodemailer, { type SendMailOptions } from "nodemailer";
import type { AuthEmail, EmailSender, SmtpEmailConfig } from "./types.js";

export type { SmtpEmailConfig } from "./types.js";

export interface SmtpMailTransport {
  sendMail(options: SendMailOptions): Promise<unknown>;
}

/** Deliberately excludes the SMTP response, original error and secret email URL. */
export class AuthEmailDeliveryError extends Error {
  readonly code = "AUTH_EMAIL_DELIVERY_FAILED";

  constructor() {
    super("The authentication email could not be sent.");
    this.name = "AuthEmailDeliveryError";
  }
}

const contentByPurpose = {
  email_verification: {
    subject: "Verify your JobFlow AI email",
    introduction: "Verify your email address to finish creating your JobFlow AI account.",
    action: "Verify email address",
  },
  password_reset: {
    subject: "Reset your JobFlow AI password",
    introduction: "Use the link below to choose a new password for your JobFlow AI account.",
    action: "Reset password",
  },
} as const;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character]!;
  });
}

function validateConfig(config: SmtpEmailConfig): void {
  if (!config.host.trim() || /[\r\n]/.test(config.host)) {
    throw new TypeError("A valid SMTP host is required.");
  }
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new TypeError("The SMTP port must be an integer between 1 and 65535.");
  }
  if (!config.from.trim() || /[\r\n]/.test(config.from)) {
    throw new TypeError("A valid SMTP sender is required.");
  }
  if ((config.user === undefined) !== (config.password === undefined)) {
    throw new TypeError("SMTP authentication requires both a username and password.");
  }
}

function validateMessage(message: AuthEmail): void {
  // One mailbox only: a recipient string must never introduce a second address.
  if (!/^[^\s@<>;,]+@[^\s@<>;,]+$/.test(message.to)) {
    throw new TypeError("A single recipient email address is required.");
  }
  let url: URL;
  try {
    url = new URL(message.url);
  } catch {
    throw new TypeError("An absolute HTTP or HTTPS authentication link is required.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    /[\r\n]/.test(message.url)
  ) {
    throw new TypeError("An absolute HTTP or HTTPS authentication link is required.");
  }
  if (
    !(message.expiresAt instanceof Date) ||
    Number.isNaN(message.expiresAt.getTime())
  ) {
    throw new TypeError("A valid authentication-link expiry is required.");
  }
  if (!Object.hasOwn(contentByPurpose, message.purpose)) {
    throw new TypeError("An unsupported authentication email purpose was provided.");
  }
}

/**
 * A provider-neutral SMTP adapter. The optional transport is for isolated tests.
 * Sending mail does not itself activate, consume or replace an auth credential.
 */
export function createSmtpEmailSender(
  config: SmtpEmailConfig,
  transport?: SmtpMailTransport,
): EmailSender {
  validateConfig(config);

  const smtpTransport = transport ?? nodemailer.createTransport({
    host: config.host.trim(),
    port: config.port,
    secure: config.secure,
    requireTLS: config.user !== undefined && !config.secure,
    ...(config.user !== undefined && config.password !== undefined
      ? { auth: { user: config.user, pass: config.password } }
      : {}),
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  });

  return {
    async sendAuthEmail(message): Promise<void> {
      validateMessage(message);
      const content = contentByPurpose[message.purpose];
      const expiry = message.expiresAt.toISOString();
      const escapedUrl = escapeHtml(message.url);
      const text = [
        content.introduction,
        "",
        `${content.action}: ${message.url}`,
        "",
        `This link expires at ${expiry} (UTC).`,
        "Only your most recently issued link for this action can be used.",
        "If you did not request this email, you can ignore it.",
      ].join("\n");
      const html = [
        "<!doctype html><html><body>",
        `<p>${escapeHtml(content.introduction)}</p>`,
        `<p><a href="${escapedUrl}">${escapeHtml(content.action)}</a></p>`,
        "<p>If the button does not work, copy this link into your browser:</p>",
        `<p>${escapedUrl}</p>`,
        `<p>This link expires at ${escapeHtml(expiry)} (UTC).</p>`,
        "<p>Only your most recently issued link for this action can be used.</p>",
        "<p>If you did not request this email, you can ignore it.</p>",
        "</body></html>",
      ].join("\n");

      try {
        await smtpTransport.sendMail({
          from: config.from.trim(),
          to: { name: "", address: message.to },
          subject: content.subject,
          text,
          html,
          disableFileAccess: true,
          disableUrlAccess: true,
        });
      } catch {
        throw new AuthEmailDeliveryError();
      }
    },
  };
}
