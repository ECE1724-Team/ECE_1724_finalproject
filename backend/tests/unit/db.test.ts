import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import type { PoolClient } from "pg";
import { createPool } from "../../src/db/pool.js";
import { withTransaction } from "../../src/db/transaction.js";

test("database modules import with no DATABASE_URL", () => {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  execFileSync(process.execPath, [
    "-e", "for (const path of process.argv.slice(1)) require(path)",
    require.resolve("../../src/db/pool.js"), require.resolve("../../src/db/transaction.js"),
  ], { env });
});

test("createPool validates configuration when called", () => {
  assert.throws(() => createPool({ DATABASE_URL: "  " }), /DATABASE_URL is not configured/);
  assert.throws(() => createPool({ DATABASE_URL: "https://example.test/db" }), /PostgreSQL connection URL/);
  assert.throws(() => createPool({ DATABASE_URL: "postgresql://localhost:invalid/db" }), /PostgreSQL connection URL/);
  assert.throws(() => createPool({ DATABASE_URL: "postgresql://localhost" }), /must name the PostgreSQL database/);
});

test("a successful transaction commits and releases the client once", async (t) => {
  const pool = createPool({ DATABASE_URL: "postgresql://localhost/unit_test" });
  t.after(() => pool.end());
  const query = t.mock.fn(async (_sql: string) => {});
  const release = t.mock.fn((_discard?: boolean) => {});
  const client = { query, release } as unknown as PoolClient;
  const connect = t.mock.method(pool, "connect", async () => client);

  const result = await withTransaction(pool, async (borrowed) => {
    assert.equal(borrowed, client);
    await borrowed.query("SELECT 1");
    return "committed";
  });

  assert.equal(result, "committed");
  assert.equal(connect.mock.callCount(), 1);
  assert.deepEqual(query.mock.calls.map(({ arguments: args }) => args[0]), ["BEGIN", "SELECT 1", "COMMIT"]);
  assert.equal(release.mock.callCount(), 1);
  assert.equal(release.mock.calls[0].arguments[0], undefined);
});

for (const rollbackFails of [false, true]) {
  test(`callback error survives ${rollbackFails ? "failed" : "successful"} rollback`, async (t) => {
    const pool = createPool({ DATABASE_URL: "postgresql://localhost/unit_test" });
    t.after(() => pool.end());
    const original = new Error("callback failed after a write");
    const rollbackError = new Error("lost connection");
    const log = t.mock.method(console, "error", () => {});
    const query = t.mock.fn(async (sql: string) => {
      if (sql === "ROLLBACK" && rollbackFails) throw rollbackError;
    });
    const release = t.mock.fn((_discard?: boolean) => {});
    const client = { query, release } as unknown as PoolClient;
    const connect = t.mock.method(pool, "connect", async () => client);

    await assert.rejects(withTransaction(pool, async (borrowed) => {
      assert.equal(borrowed, client);
      await borrowed.query("INSERT fixture");
      throw original;
    }), (error) => error === original);

    assert.equal(connect.mock.callCount(), 1);
    assert.deepEqual(query.mock.calls.map(({ arguments: args }) => args[0]), ["BEGIN", "INSERT fixture", "ROLLBACK"]);
    assert.equal(release.mock.callCount(), 1);
    assert.equal(release.mock.calls[0].arguments[0], rollbackFails ? true : undefined);
    if (rollbackFails) assert.equal(log.mock.calls[0].arguments[1], rollbackError);
  });
}
