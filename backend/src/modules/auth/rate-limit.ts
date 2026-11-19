import { createHmac } from "node:crypto";
import type { BetterAuthRateLimitStorage } from "@better-auth/core";
import type { Pool } from "pg";

/** Independent security counters survive a failed/rolled-back login attempt. */
export function createRateLimitStorage(pool: Pool, secret: string): BetterAuthRateLimitStorage {
  return {
    async consume(rawKey, rule) {
      // Native reset routes can contain credentials. Never persist raw paths.
      const key = createHmac("sha256", secret).update(rawKey).digest("hex");
      const now = Date.now();
      const result = await pool.query(
        `INSERT INTO public.auth_rate_limit AS limits ("key", "count", "lastRequest") VALUES ($1, 1, $2)
         ON CONFLICT ("key") DO UPDATE SET
           "count" = CASE WHEN limits."lastRequest" <= $3 THEN 1 ELSE limits."count" + 1 END,
           "lastRequest" = $2
         WHERE limits."lastRequest" <= $3 OR limits."count" < $4
         RETURNING "count"`,
        [key, now, now - rule.window * 1000, rule.max],
      );
      if (result.rowCount) return { allowed: true, retryAfter: null };
      const current = await pool.query<{ lastRequest: string }>('SELECT "lastRequest" FROM public.auth_rate_limit WHERE "key" = $1', [key]);
      const remaining = Number(current.rows[0]?.lastRequest ?? now) + rule.window * 1000 - now;
      return { allowed: false, retryAfter: Math.max(1, Math.ceil(remaining / 1000)) };
    },
  };
}
