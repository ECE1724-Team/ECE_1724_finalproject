import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { runWithAdapter, runWithTransaction } from "@better-auth/core/context";
import type { BetterAuthOptions } from "@better-auth/core";
import { Pool, type PoolClient, type QueryResult } from "pg";
import { Database } from "../../src/db/transaction.js";
import { createPostgresAuthAdapter } from "../../src/modules/auth/pg-adapter.js";

function fakePool() {
  const commands: string[] = [];
  let connections = 0;
  let releases = 0;
  const client = {
    async query(text: string): Promise<QueryResult> {
      commands.push(text);
      return { command: text, rowCount: 0, rows: [], fields: [], oid: 0 };
    },
    release() { releases += 1; },
  } as unknown as PoolClient;
  const pool = {
    async connect() { connections += 1; return client; },
    async query(text: string) { commands.push(`pool:${text}`); return { rows: [] }; },
  } as unknown as Pool;
  return { database: new Database(pool), client, commands, connections: () => connections, releases: () => releases };
}

test("nested transactions share a client and only the outer call commits", async () => {
  const fake = fakePool();
  assert.equal(fake.database.currentClient(), undefined);
  const result = await fake.database.transaction(async (client) => {
    assert.equal(client, fake.client);
    await fake.database.query("outer");
    return fake.database.transaction(async (nested) => {
      assert.equal(nested, client);
      assert.equal(fake.database.currentClient(), client);
      await fake.database.query("inner");
      return 42;
    });
  });
  assert.equal(result, 42);
  assert.deepEqual(fake.commands, ["BEGIN", "outer", "inner", "COMMIT"]);
  assert.equal(fake.connections(), 1);
  assert.equal(fake.releases(), 1);
  assert.equal(fake.database.currentClient(), undefined);
});

test("a caught nested failure still rolls back the whole transaction", async () => {
  const fake = fakePool();
  const failure = new Error("native operation failed");
  await assert.rejects(fake.database.transaction(async () => {
    await fake.database.query("write before failure");
    try {
      await fake.database.transaction(async () => { throw failure; });
    } catch { /* Simulate a library swallowing its callback error. */ }
    return "must not commit";
  }), (error) => error === failure);
  assert.deepEqual(fake.commands, ["BEGIN", "write before failure", "ROLLBACK"]);
  assert.equal(fake.releases(), 1);
});

test("native core ALS resets cannot detach the PostgreSQL transaction", async () => {
  const fake = fakePool();
  const adapter = createPostgresAuthAdapter(fake.database)({
    user: { modelName: "auth_user" },
    account: { modelName: "auth_account" },
    session: { modelName: "auth_session" },
    verification: { modelName: "auth_verification" },
  });
  await fake.database.transaction(async (client) => {
    await runWithAdapter(adapter, async () => {
      await runWithTransaction(adapter, async () => {
        assert.equal(fake.database.currentClient(), client);
        await adapter.deleteMany({ model: "session", where: [{ field: "userId", value: randomUUID() }] });
      });
    });
    assert.ok(!fake.commands.includes("COMMIT"));
  });
  assert.equal(fake.connections(), 1);
  assert.equal(fake.commands.filter((command) => command === "BEGIN").length, 1);
  assert.equal(fake.commands.filter((command) => command === "COMMIT").length, 1);
  assert.ok(fake.commands.every((command) => !command.startsWith("pool:")));
});

test("adapter refuses models outside its reviewed authentication tables", () => {
  const fake = fakePool();
  assert.throws(() => createPostgresAuthAdapter(fake.database)({}), /Unsupported auth model mapping/);
});

// TEST_DATABASE_URL is an administrative connection only. Every fixture and
// adapter operation uses a separate randomly named database owned by this suite.
const administrativeUrl = process.env.TEST_DATABASE_URL;
describe("PostgreSQL authentication adapter", { skip: !administrativeUrl }, () => {
  const databaseName = `jobflow_adapter_test_${randomUUID().replaceAll("-", "")}`;
  const isolatedUrl = administrativeUrl ? new URL(administrativeUrl) : undefined;
  if (isolatedUrl) isolatedUrl.pathname = `/${databaseName}`;
  const admin = new Pool({ connectionString: administrativeUrl, max: 1 });
  const pool = new Pool({ connectionString: isolatedUrl?.href, max: 6 });
  const database = new Database(pool);
  let createdDatabase = false;
  const options: BetterAuthOptions = {
    advanced: { database: { generateId: "uuid", joins: true } },
    user: {
      modelName: "auth_user",
      fields: { email: "email_address" },
      additionalFields: { metadata: { type: "json", required: false } },
    },
    account: { modelName: "auth_account" },
    session: { modelName: "auth_session" },
    verification: { modelName: "auth_verification" },
    rateLimit: { storage: "database", modelName: "auth_rate_limit" },
  };
  const adapter = createPostgresAuthAdapter(database)(options);

  before(async () => {
    // databaseName contains only this fixed prefix and random hexadecimal text.
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    createdDatabase = true;
    await database.transaction(async () => {
      await database.query(`
        CREATE TABLE public.auth_user (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
          email_address text NOT NULL UNIQUE, "emailVerified" boolean NOT NULL,
          image text, "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL,
          metadata jsonb
        );
        CREATE TABLE public.auth_session (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "userId" uuid NOT NULL REFERENCES public.auth_user(id),
          token text NOT NULL UNIQUE, "expiresAt" timestamptz NOT NULL,
          "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL,
          "ipAddress" text, "userAgent" text
        );
        CREATE TABLE public.auth_verification (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), identifier text NOT NULL,
          value text NOT NULL, "expiresAt" timestamptz NOT NULL,
          "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL
        );
        CREATE TABLE public.auth_rate_limit (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), key text NOT NULL UNIQUE,
          count integer NOT NULL, "lastRequest" bigint NOT NULL
        );
      `);
    });
  });

  after(async () => {
    try {
      await pool.end();
    } finally {
      try {
        if (createdDatabase) await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
      } finally {
        await admin.end();
      }
    }
  });

  async function user(email = `${randomUUID()}@example.test`) {
    return adapter.create<Record<string, unknown>, { id: string; email: string; emailVerified: boolean; createdAt: Date; metadata: unknown }>({
      model: "user",
      data: { name: "Contract test", email, emailVerified: false, metadata: ["text", { current: true }] },
    });
  }

  test("mapped fields, UUID defaults, dates, booleans, JSON arrays and SQL parameters round-trip", async () => {
    const email = `x' OR TRUE; --_${randomUUID()}@example.test`;
    const saved = await user(email);
    assert.match(saved.id, /^[0-9a-f-]{36}$/);
    assert.equal(saved.email, email);
    assert.equal(saved.emailVerified, false);
    assert.ok(saved.createdAt instanceof Date);
    assert.deepEqual(saved.metadata, ["text", { current: true }]);
    const found = await adapter.findOne<{ id: string }>({ model: "user", where: [{ field: "email", value: email }] });
    assert.equal(found?.id, saved.id);
    assert.equal(await adapter.count({ model: "user", where: [{ field: "email", value: "does-not-exist' OR TRUE --" }] }), 0);
    const projected = await adapter.findOne<Record<string, unknown>>({ model: "user", where: [{ field: "id", value: saved.id }], select: ["email"] });
    assert.deepEqual(projected, { email });
  });

  test("factory fallback joins still work when native joins were requested", async () => {
    const saved = await user();
    await adapter.create({ model: "session", data: { userId: saved.id, token: randomUUID(), expiresAt: new Date(Date.now() + 60_000) } });
    const found = await adapter.findOne<{ user: { id: string; email: string } }>({ model: "session", where: [{ field: "userId", value: saved.id }], join: { user: true } });
    assert.equal(found?.user.id, saved.id);
    assert.equal(found?.user.email, saved.email);
  });

  test("native and custom writes roll back together across a core ALS reset", async () => {
    const email = `${randomUUID()}@rollback.test`;
    await assert.rejects(database.transaction(async () => {
      await runWithAdapter(adapter, () => runWithTransaction(adapter, async () => {
        const saved = await user(email);
        await database.query('UPDATE public.auth_user SET "emailVerified" = TRUE WHERE id = $1', [saved.id]);
      }));
      throw new Error("fail after native inner transaction returned");
    }), /fail after native/);
    assert.equal(await adapter.count({ model: "user", where: [{ field: "email", value: email }] }), 0);
  });

  test("two consumers of one credential have exactly one winner", async () => {
    const identifier = randomUUID();
    await adapter.create({ model: "verification", data: { identifier, value: randomUUID(), expiresAt: new Date(Date.now() + 60_000) } });
    const results = await Promise.all([1, 2].map(() => adapter.consumeOne({ model: "verification", where: [{ field: "identifier", value: identifier }] })));
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(await adapter.count({ model: "verification", where: [{ field: "identifier", value: identifier }] }), 0);
  });

  test("guarded increments recheck after waiting and cannot spend the last use twice", async () => {
    const key = randomUUID();
    await adapter.create({ model: "rateLimit", data: { key, count: 1, lastRequest: Date.now() } });
    const results = await Promise.all([1, 2].map(() => adapter.incrementOne<{ count: number }>({
      model: "rateLimit", where: [{ field: "key", value: key }, { field: "count", operator: "gt", value: 0 }], increment: { count: -1 },
    })));
    assert.equal(results.filter(Boolean).length, 1);
    const current = await adapter.findOne<{ count: number; lastRequest: number }>({ model: "rateLimit", where: [{ field: "key", value: key }] });
    assert.equal(current?.count, 0);
    assert.equal(typeof current?.lastRequest, "number");
  });

  test("single-row writes never mutate all rows matching a nonunique guard", async () => {
    const marker = Date.now();
    await Promise.all([1, 2].map(() => adapter.create({ model: "rateLimit", data: { key: randomUUID(), count: 10, lastRequest: marker } })));
    await adapter.incrementOne({ model: "rateLimit", where: [{ field: "lastRequest", value: marker }], increment: { count: 1 } });
    assert.equal(await adapter.count({ model: "rateLimit", where: [{ field: "lastRequest", value: marker }, { field: "count", value: 11 }] }), 1);
    await adapter.consumeOne({ model: "rateLimit", where: [{ field: "lastRequest", value: marker }] });
    assert.equal(await adapter.count({ model: "rateLimit", where: [{ field: "lastRequest", value: marker }] }), 1);
  });
});
