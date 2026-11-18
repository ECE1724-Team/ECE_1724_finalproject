import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import type { Pool } from "pg";
import { createPool } from "../../src/db/pool.js";

const exec = promisify(execFile);
const migrationCli = require.resolve("node-pg-migrate/bin/node-pg-migrate");

interface TestDatabase {
  pool: Pool;
  migrate: (command?: { down: number }) => Promise<void>;
}

/** Each caller gets a fresh database, even for tests that commit their own writes. */
export async function withTestDatabase(run: (database: TestDatabase) => Promise<void>): Promise<void> {
  const testUrl = process.env.TEST_DATABASE_URL?.trim();
  if (!testUrl) {
    throw new Error("TEST_DATABASE_URL is required for npm run test:db. See backend/README.md.");
  }
  const url = URL.parse(testUrl);
  if (!url || url.pathname.length <= 1) {
    throw new Error("TEST_DATABASE_URL must identify a PostgreSQL test database.");
  }

  const admin = createPool({ DATABASE_URL: testUrl });
  const name = `jobflow_test_${randomUUID().replaceAll("-", "")}`;
  url.pathname = `/${name}`;
  const targetUrl = url.href;

  try {
    // The identifier is generated locally from a UUID, never from configuration.
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
    try {
      const pool = createPool({ DATABASE_URL: targetUrl });
      try {
        await run({
          pool,
          async migrate(command) {
            const args = command ? ["down", String(command.down)] : ["up"];
            await exec(process.execPath, [migrationCli, ...args, "--no-verbose"], {
              env: { ...process.env, DATABASE_URL: targetUrl },
              timeout: 30_000,
            });
          },
        });
      } finally {
        await pool.end();
      }
    } finally {
      await admin.query(`DROP DATABASE "${name}"`);
    }
  } finally {
    await admin.end();
  }
}

export async function insertTestOwners(db: Pick<Pool, "query">) {
  const first = { id: randomUUID(), name: "Avery Test", email: `avery-${randomUUID()}@example.test` };
  const second = { id: randomUUID(), name: "Blair Test", email: `blair-${randomUUID()}@example.test` };
  await db.query(
    `INSERT INTO public.auth_user (id, name, email, "emailVerified")
     VALUES ($1, $2, $3, TRUE), ($4, $5, $6, TRUE)`,
    [first.id, first.name, first.email, second.id, second.name, second.email],
  );
  return { first, second };
}
