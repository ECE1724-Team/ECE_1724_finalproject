import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import type { Pool } from "pg";
import { withTransaction } from "../../src/db/transaction.js";
import { insertTestOwners, withTestDatabase } from "../helpers/database.js";

const exec = promisify(execFile);

const migrationNames = [
  "20261111000100_auth_core",
  "20261111000200_auth_credentials",
  "20261116000100_create_resumes_applications",
  "20261116000200_create_status_history_interviews",
  "20261116000300_create_ai_workspaces_conversations",
  "20261116000400_create_ai_persistence",
  "20261118000700_create_storage_cleanup_jobs",
];

const publicTables = [
  "ai_workspaces", "application_status_history", "applications", "auth_account",
  "auth_credential_state", "auth_email_rate_limit", "auth_rate_limit", "auth_session",
  "auth_user", "auth_verification", "conversation_summaries", "conversations",
  "generation_materials", "generation_runs", "interviews", "material_snapshots",
  "messages", "pgmigrations", "resumes", "storage_cleanup_jobs",
];

async function migrationHistory(pool: Pool) {
  const { rows } = await pool.query<{ id: number; name: string; run_on: Date }>(
    "SELECT id, name, run_on FROM public.pgmigrations ORDER BY id",
  );
  return rows;
}

interface CatalogEntry {
  kind: "column" | "constraint" | "index";
  relation: string;
  name: string;
  definition: string;
}

function readCatalog(pool: Pool) {
  return withTransaction(pool, async (client) => {
    // Make PostgreSQL qualify references to public tables in constraint definitions.
    await client.query("SET LOCAL search_path TO pg_catalog");
    const { rows } = await client.query<CatalogEntry>(`
      SELECT 'column' AS kind, table_name AS relation, column_name AS name,
             concat_ws(' ', data_type, is_nullable, column_default) AS definition
      FROM information_schema.columns WHERE table_schema = 'public'
      UNION ALL
      SELECT 'constraint', rel.relname, con.conname, pg_get_constraintdef(con.oid)
      FROM pg_constraint con JOIN pg_class rel ON con.conrelid = rel.oid
      WHERE rel.relnamespace = 'public'::regnamespace
      UNION ALL
      SELECT 'index', tablename, indexname, indexdef
      FROM pg_indexes WHERE schemaname = 'public'
      ORDER BY kind, relation, name
    `);
    return rows;
  });
}

function tableNames(catalog: CatalogEntry[]) {
  return [...new Set(catalog.filter(({ kind }) => kind === "column").map(({ relation }) => relation))].sort();
}

function assertForeignKeys(catalog: CatalogEntry[]) {
  const foreignKeys = [
    ["resumes", "user_id", "auth_user", "id", "RESTRICT"],
    ["applications", "user_id", "auth_user", "id", "RESTRICT"],
    ["applications", "resume_id, user_id", "resumes", "id, user_id", "RESTRICT"],
    ["application_status_history", "application_id", "applications", "id", "CASCADE"],
    ["interviews", "application_id", "applications", "id", "CASCADE"],
    ["ai_workspaces", "application_id", "applications", "id", "CASCADE"],
    ["conversations", "workspace_id", "ai_workspaces", "id", "CASCADE"],
    ["generation_runs", "conversation_id", "conversations", "id", "CASCADE"],
    ["messages", "conversation_id", "conversations", "id", "CASCADE"],
    ["material_snapshots", "conversation_id", "conversations", "id", "CASCADE"],
    ["generation_materials", "conversation_id", "conversations", "id", "CASCADE"],
    ["conversation_summaries", "conversation_id", "conversations", "id", "CASCADE"],
    ["generation_runs", "input_message_id, conversation_id", "messages", "id, conversation_id"],
    ["generation_runs", "baseline_generation_id, conversation_id", "generation_runs", "id, conversation_id"],
    ["messages", "generation_id, conversation_id", "generation_runs", "id, conversation_id"],
    ["material_snapshots", "generation_id, conversation_id", "generation_runs", "id, conversation_id"],
    ["generation_materials", "generation_id, conversation_id", "generation_runs", "id, conversation_id"],
    ["generation_materials", "snapshot_id, conversation_id, kind", "material_snapshots", "id, conversation_id, kind"],
    ["conversation_summaries", "previous_summary_id, conversation_id", "conversation_summaries", "id, conversation_id"],
  ];

  for (const [table, columns, target, targetColumns, onDelete] of foreignKeys) {
    const action = onDelete ? ` ON DELETE ${onDelete}` : ""; // PostgreSQL omits the default NO ACTION.
    const definition = `FOREIGN KEY (${columns}) REFERENCES public.${target}(${targetColumns})${action}`;
    assert.ok(catalog.some((row) => row.relation === table && row.definition === definition), `${table}: ${definition}`);
  }
}

test("the migrations share one history and reproduce the schema after up, up, down, up", async () => {
  await withTestDatabase(async ({ pool, migrate }) => {
    assert.deepEqual(tableNames(await readCatalog(pool)), []);
    await migrate();
    const history = await migrationHistory(pool);
    assert.deepEqual(history.map(({ name }) => name), migrationNames);

    const catalog = await readCatalog(pool);
    assert.deepEqual(tableNames(catalog), publicTables);
    assertForeignKeys(catalog);
    const activeIndex = catalog.find(({ kind, name }) => kind === "index" && name === "generation_runs_one_active_idx");
    assert.equal(activeIndex?.definition,
      "CREATE UNIQUE INDEX generation_runs_one_active_idx ON public.generation_runs USING btree (conversation_id) "
      + "WHERE (status = ANY (ARRAY['preparing'::text, 'streaming'::text]))");
    const cleanupIndex = catalog.find(({ kind, name }) => kind === "index" && name === "storage_cleanup_jobs_status_next_attempt_idx");
    assert.equal(cleanupIndex?.definition, "CREATE INDEX storage_cleanup_jobs_status_next_attempt_idx "
      + "ON public.storage_cleanup_jobs USING btree (status, next_attempt_at)");

    await migrate();
    assert.deepEqual(await migrationHistory(pool), history);
    assert.deepEqual(await readCatalog(pool), catalog);

    await migrate({ down: 1 });
    assert.deepEqual(await migrationHistory(pool), history.slice(0, -1));
    assert.deepEqual(await readCatalog(pool), catalog.filter(({ relation }) => relation !== "storage_cleanup_jobs"));
    await migrate();

    await migrate({ down: migrationNames.length });
    assert.deepEqual(await migrationHistory(pool), []);
    assert.deepEqual(tableNames(await readCatalog(pool)), ["pgmigrations"]);

    await migrate();
    assert.deepEqual((await migrationHistory(pool)).map(({ name }) => name), migrationNames);
    assert.deepEqual(await readCatalog(pool), catalog);
  });
});

test("both migration commands use only the validated DATABASE_URL to select their database", () => withTestDatabase(async ({ pool, url }) => {
  const cwd = await mkdtemp(join(tmpdir(), "jobflow-migrate-"));
  let connections = 0;
  const fallback = createServer((socket) => {
    connections++;
    socket.destroy();
  });

  try {
    // Exercise the package script in a directory with its own .env.
    for (const entry of ["package.json", "node_modules", "scripts", "migrations"]) {
      await symlink(resolve(entry), join(cwd, entry));
    }
    fallback.listen(0, "127.0.0.1");
    await once(fallback, "listening");
    const { port } = fallback.address() as AddressInfo;
    const env = { ...process.env };
    delete env.DATABASE_URL;
    const fallbackEnv = { ...env, PGHOST: "127.0.0.1", PGPORT: String(port), PGUSER: "fallback", PGDATABASE: "fallback",
      JOBFLOW_TEST_UNUSED_DATABASE_URL: "" };
    const run = (command: string, env: NodeJS.ProcessEnv, ...args: string[]) =>
      exec("npm", ["run", command, "--", ...args], { cwd, env, timeout: 30_000 });
    const envPath = join(cwd, ".env");
    const rejectedUrls = [
      ["PGAPPNAME=jobflow_migration_test", /DATABASE_URL is not configured/],
      ['DATABASE_URL="  "', /DATABASE_URL is not configured/],
      ["DATABASE_URL=https://example.test/db", /DATABASE_URL must be a PostgreSQL connection URL/],
      ["DATABASE_URL=postgresql://127.0.0.1", /DATABASE_URL must name the PostgreSQL database/],
    ] as const;
    for (const command of ["migrate", "migrate:down"]) {
      for (const [contents, message] of rejectedUrls) {
        await writeFile(envPath, `${contents}\n`);
        await assert.rejects(run(command, fallbackEnv), { code: 1, stderr: message });
      }
      await writeFile(envPath, `DATABASE_URL="${url}"\n`);
      await assert.rejects(run(command, fallbackEnv, "--database-url-var", "JOBFLOW_TEST_UNUSED_DATABASE_URL"),
        { code: 1, stderr: /Unknown option/ });
    }
    assert.equal(connections, 0);
    assert.deepEqual(tableNames(await readCatalog(pool)), []);

    await run("migrate", env);
    assert.deepEqual((await migrationHistory(pool)).map(({ name }) => name), migrationNames);
    await run("migrate:down", env);
    assert.deepEqual((await migrationHistory(pool)).map(({ name }) => name), migrationNames.slice(0, -1));
    assert.deepEqual(tableNames(await readCatalog(pool)), publicTables.filter((table) => table !== "storage_cleanup_jobs"));
    assert.equal(connections, 0);
  } finally {
    if (fallback.listening) await promisify(fallback.close).call(fallback);
    await rm(cwd, { recursive: true, force: true });
  }
}));

test("PostgreSQL persists a committed write and removes a failed callback's first write", async () => {
  await withTestDatabase(async ({ pool, migrate }) => {
    await migrate();
    const { first, second } = await insertTestOwners(pool);
    const reader = await pool.connect();
    try {
      const applications = async () => (await reader.query<{ user_id: string }>(
        "SELECT user_id FROM public.applications ORDER BY user_id",
      )).rows;
      const insert = `INSERT INTO public.applications (user_id, company_name, position_title)
                      VALUES ($1, 'Example Company', 'Engineer')`;

      await withTransaction(pool, async (client) => {
        await client.query(insert, [first.id]);
        assert.deepEqual(await applications(), []);
      });
      assert.deepEqual(await applications(), [{ user_id: first.id }]);

      const original = new Error("failed after first write");
      await assert.rejects(withTransaction(pool, async (client) => {
        await client.query(insert, [second.id]);
        throw original;
      }), (error) => error === original);
      assert.deepEqual(await applications(), [{ user_id: first.id }]);
    } finally {
      reader.release();
    }
  });
});
