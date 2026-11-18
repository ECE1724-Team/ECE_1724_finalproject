import type { Pool } from "pg";
import { ConfigurationError } from "../../config/errors.js";

/** Tables created by the two auth migrations (Database Design Appendix E). */
const AUTH_TABLES = [
  "auth_user", "auth_account", "auth_session", "auth_verification", "auth_rate_limit",
  "auth_credential_state", "auth_email_rate_limit",
] as const;

/**
 * Fails startup when the auth migrations have not been applied. The server never creates or
 * migrates the schema itself; run `npm run migrate`.
 */
export async function assertAuthSchema(pool: Pool): Promise<void> {
  const result = await pool.query<{ missing: string[] }>(
    `SELECT COALESCE(array_agg(name ORDER BY name), '{}') AS missing
       FROM unnest($1::text[]) AS name
      WHERE to_regclass('public.' || quote_ident(name)) IS NULL`,
    [AUTH_TABLES],
  );
  const missing = result.rows[0]?.missing ?? [];
  if (missing.length) {
    throw new ConfigurationError(`Authentication schema is missing (${missing.join(", ")}); run npm run migrate first`);
  }
}
