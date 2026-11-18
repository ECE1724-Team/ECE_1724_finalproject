import { parseArgs } from "node:util";
import { runner } from "node-pg-migrate";
import { readDatabaseUrl } from "../src/db/database-url.mts";

try {
  const connectionString = readDatabaseUrl();
  const { values } = parseArgs({ options: { "dry-run": { type: "boolean" } } });

  await runner({
    databaseUrl: connectionString,
    direction: "up",
    dir: "migrations",
    schema: "public",
    migrationsTable: "pgmigrations",
    singleTransaction: true,
    verbose: false,
    dryRun: values["dry-run"],
  });
  console.log("Migrations complete!");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
