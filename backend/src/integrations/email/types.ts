export type AuthEmailPurpose = "email_verification" | "password_reset";

export interface AuthEmail {
  to: string;
  url: string;
  purpose: AuthEmailPurpose;
  expiresAt: Date;
}

export interface EmailSender {
  /** Resolves after the configured transport accepts the send operation. */
  sendAuthEmail(message: AuthEmail): Promise<void>;
}

export interface SmtpEmailConfig {
  host: string;
  port: number;
  secure: boolean;
  from: string;
  user?: string;
  password?: string;
}
