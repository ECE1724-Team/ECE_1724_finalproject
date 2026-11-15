import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { AuthConfig } from "../../config/env.js";
import { Database } from "../../db/transaction.js";
import type { AuthEmail } from "../../integrations/email/types.js";
import { AuthFailure } from "./errors.js";

export type CredentialPurpose = "email_verification" | "password_reset";
export interface PendingCredential extends AuthEmail {
  userId: string;
  issuanceId: string;
  sequence: string;
  token: string;
  issuedAt: Date;
}

export interface CredentialUser {
  id: string;
  email: string;
  emailVerified: boolean;
}

export function tokenDigest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function sameDigest(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex"), b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Current links change only after SMTP accepts the corresponding message. */
export class CredentialStore {
  constructor(
    private readonly database: Database,
    private readonly config: AuthConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async lockUserByEmail(email: string): Promise<CredentialUser | null> {
    const result = await this.database.query<CredentialUser>(
      'SELECT id, email, "emailVerified" FROM public.auth_user WHERE email = $1 FOR UPDATE',
      [email.toLowerCase()],
    );
    return result.rows[0] ?? null;
  }

  async lockUserById(id: string): Promise<CredentialUser | null> {
    if (!isUuid(id)) return null;
    const result = await this.database.query<CredentialUser>(
      'SELECT id, email, "emailVerified" FROM public.auth_user WHERE id = $1 FOR UPDATE', [id],
    );
    return result.rows[0] ?? null;
  }

  /** Also applied to nonexistent/already-verified addresses to avoid enumeration. */
  async reserveEmailRequest(email: string, purpose: CredentialPurpose): Promise<void> {
    const key = createHmac("sha256", this.config.secret).update(`${purpose}\0${email.toLowerCase()}`).digest("hex");
    const now = this.now();
    await this.database.query(
      `INSERT INTO public.auth_email_rate_limit (key, window_started_at, request_count)
       VALUES ($1, $2, 0) ON CONFLICT (key) DO NOTHING`, [key, now],
    );
    const result = await this.database.query<{
      window_started_at: Date; request_count: number; last_requested_at: Date | null;
    }>('SELECT * FROM public.auth_email_rate_limit WHERE key = $1 FOR UPDATE', [key]);
    const state = result.rows[0]!;
    const elapsed = now.getTime() - (state.last_requested_at?.getTime() ?? -Infinity);
    if (elapsed < this.config.emailCooldownSeconds * 1000) {
      throw new AuthFailure(429, "EMAIL_COOLDOWN", "Please wait before requesting another email", Math.max(1, Math.ceil(this.config.emailCooldownSeconds - elapsed / 1000)));
    }
    const newWindow = now.getTime() - state.window_started_at.getTime() >= this.config.emailWindowSeconds * 1000;
    if (!newWindow && state.request_count >= this.config.emailMaxPerWindow) {
      throw new AuthFailure(429, "EMAIL_RATE_LIMIT", "Email request limit reached", Math.max(1, Math.ceil((state.window_started_at.getTime() + this.config.emailWindowSeconds * 1000 - now.getTime()) / 1000)));
    }
    await this.database.query(
      `UPDATE public.auth_email_rate_limit SET window_started_at = $2, request_count = $3, last_requested_at = $4 WHERE key = $1`,
      [key, newWindow ? now : state.window_started_at, newWindow ? 1 : state.request_count + 1, now],
    );
  }

  async prepare(credential: Omit<PendingCredential, "sequence">): Promise<PendingCredential> {
    if (!this.database.currentClient()) throw new Error("Credential preparation requires an auth transaction");
    const result = await this.database.query<{ sequence: string }>(
      `INSERT INTO public.auth_credential_state AS current_state (user_id, purpose, sequence) VALUES ($1, $2, 1)
       ON CONFLICT (user_id, purpose) DO UPDATE SET sequence = current_state.sequence + 1
       RETURNING sequence`, [credential.userId, credential.purpose],
    );
    return { ...credential, sequence: result.rows[0]!.sequence };
  }

  async activate(credential: PendingCredential): Promise<void> {
    await this.database.transaction(async () => {
      if (!await this.lockUserById(credential.userId)) return;
      if (credential.expiresAt.getTime() <= this.now().getTime()) return;
      // A slow older send must never replace a newer successfully accepted send.
      await this.database.query(
        `UPDATE public.auth_credential_state SET active_sequence = $3, current_issuance_id = $4,
           current_token_digest = $5, issued_at = $6, expires_at = $7
         WHERE user_id = $1 AND purpose = $2
           AND (active_sequence IS NULL OR active_sequence < $3)`,
        [credential.userId, credential.purpose, credential.sequence, credential.issuanceId,
          tokenDigest(credential.token), credential.issuedAt, credential.expiresAt],
      );
    });
  }

  async checkLatest(userId: string, purpose: CredentialPurpose, token: string, issuanceId?: string): Promise<"valid" | "invalid" | "expired"> {
    const result = await this.database.query<{
      current_token_digest: string | null; current_issuance_id: string | null; expires_at: Date | null;
    }>('SELECT current_token_digest, current_issuance_id, expires_at FROM public.auth_credential_state WHERE user_id = $1 AND purpose = $2 FOR UPDATE', [userId, purpose]);
    const current = result.rows[0];
    if (!current?.current_token_digest || !current.expires_at || !sameDigest(current.current_token_digest, tokenDigest(token)) || issuanceId !== undefined && current.current_issuance_id !== issuanceId) return "invalid";
    return current.expires_at.getTime() <= this.now().getTime() ? "expired" : "valid";
  }

  async resetRecord(token: string): Promise<{ userId: string; expiresAt: Date } | null> {
    const result = await this.database.query<{ value: string; expiresAt: Date }>(
      'SELECT value, "expiresAt" FROM public.auth_verification WHERE identifier = $1 LIMIT 1', [`reset-password:${token}`],
    );
    const record = result.rows[0];
    return record && isUuid(record.value) ? { userId: record.value, expiresAt: record.expiresAt } : null;
  }
}
