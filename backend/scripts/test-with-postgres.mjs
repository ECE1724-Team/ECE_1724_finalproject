import { spawnSync, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Runs the compiled tests (npm run test:db compiles them first), including the PostgreSQL ones.
const compiledTests = path.join(root, "dist", "tests", "tests");
const tests = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? tests(path.join(directory, entry.name)) : entry.name.endsWith(".test.js") ? [path.join(directory, entry.name)] : []);
let directory;
let pgCtl;
let started = false;
let url = process.env.TEST_DATABASE_URL;

function command(executable, args) {
  return execFileSync(executable, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

try {
  if (!url) {
    const bin = command("pg_config", ["--bindir"]);
    const initdb = path.join(bin, "initdb");
    pgCtl = path.join(bin, "pg_ctl");
    if (!existsSync(initdb) || !existsSync(pgCtl)) throw new Error("PostgreSQL server binaries are missing");
    directory = mkdtempSync(path.join(tmpdir(), "jobflow-auth-test-"));
    command(initdb, ["-D", directory, "--auth=trust", "--no-locale", "--encoding=UTF8"]);
    // A private Unix socket avoids exposing the disposable test database.
    command(pgCtl, ["-D", directory, "-l", path.join(directory, "postgres.log"), "-o", `-F -h '' -k '${directory}' -p 5432`, "-w", "start"]);
    started = true;
    const admin = new URL(`postgresql://${encodeURIComponent(userInfo().username)}@localhost/postgres`);
    admin.searchParams.set("host", directory);
    admin.searchParams.set("port", "5432");
    url = admin.href;
  }
  const result = spawnSync(process.execPath, ["--test", "--test-concurrency=1", ...tests(compiledTests)], {
    cwd: root, stdio: "inherit", env: { ...process.env, TEST_DATABASE_URL: url, NODE_ENV: "test" },
  });
  process.exitCode = result.status ?? 1;
  if (result.error) console.error("Could not run authentication tests:", result.error.message);
} catch {
  console.error("Tests require PostgreSQL server binaries and permission to create local sockets, or TEST_DATABASE_URL pointing to an isolated test server with CREATE DATABASE permission.");
  process.exitCode = 1;
} finally {
  if (started) {
    try { command(pgCtl, ["-D", directory, "-m", "fast", "-w", "stop"]); }
    catch { console.error("Could not stop the temporary PostgreSQL server; inspect the temporary test directory."); process.exitCode = 1; }
  }
  if (directory && (!started || !existsSync(path.join(directory, "postmaster.pid")))) rmSync(directory, { recursive: true, force: true });
}
