import { randomUUID } from "node:crypto";
import { createEmailVerificationToken } from "better-auth/api";
import { decodeJwt } from "jose";
import type { AuthConfig } from "../../config/env.js";
import { CREDENTIAL_LIFETIME_SECONDS } from "./constants.js";
import type { CredentialStore, PendingCredential } from "./credentials.js";
import type { RequestScopes } from "./request-scope.js";

interface EmailUser { id: string; email: string }

/**
 * Better Auth's `sendVerificationEmail` / `sendResetPassword` callbacks. They send nothing:
 * they reserve a sequence for the new credential inside the request transaction and record the
 * job, which the outbox sends after commit (Database Design Appendix E.3).
 */
export function createIssuance(config: AuthConfig, credentials: CredentialStore, scopes: RequestScopes) {
  async function record(build: () => Promise<Omit<PendingCredential, "sequence">>): Promise<void> {
    const scope = scopes.current();
    try {
      if (!scope) throw new Error("Email issuance must run inside the project auth handler");
      scope.jobs.push(await credentials.prepare(await build()));
    } catch (error) {
      if (scope) scope.issuanceError = error;
      throw error;
    }
  }

  return {
    sendVerificationEmail: ({ user, url }: { user: EmailUser; url: string }) => record(async () => {
      // A fresh token with a random `jti` replaces the library's: two sends in the same second
      // would otherwise produce identical tokens, and "only the latest link works" needs to tell
      // them apart.
      const issuanceId = randomUUID();
      const token = await createEmailVerificationToken(config.secret, user.email, undefined,
        CREDENTIAL_LIFETIME_SECONDS, { userId: user.id, jti: issuanceId });
      const claims = decodeJwt(token);
      if (typeof claims.iat !== "number" || typeof claims.exp !== "number") throw new Error("Missing credential timestamps");
      const link = new URL(url);
      link.searchParams.set("token", token);
      return {
        to: user.email, url: link.href, purpose: "email_verification", userId: user.id, token, issuanceId,
        issuedAt: new Date(claims.iat * 1000), expiresAt: new Date(claims.exp * 1000),
      };
    }),

    sendResetPassword: ({ user, token, url }: { user: EmailUser; token: string; url: string }) => record(async () => {
      // Better Auth has just stored its reset record; its expiry is the credential's expiry.
      const native = await credentials.resetRecord(token);
      if (!native || native.userId !== user.id) throw new Error("Missing native reset credential");
      return {
        to: user.email, url, purpose: "password_reset", userId: user.id, token, issuanceId: randomUUID(),
        expiresAt: native.expiresAt, issuedAt: new Date(native.expiresAt.getTime() - CREDENTIAL_LIFETIME_SECONDS * 1000),
      };
    }),
  };
}
