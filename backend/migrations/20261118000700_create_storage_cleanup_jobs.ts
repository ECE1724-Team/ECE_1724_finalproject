import type { MigrationBuilder } from "node-pg-migrate";

export function up(pgm: MigrationBuilder): void {
  pgm.createTable("storage_cleanup_jobs", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    object_key: { type: "text", notNull: true },
    reason: { type: "text", notNull: true },
    status: { type: "text", notNull: true, default: "pending" },
    attempt_count: { type: "integer", notNull: true, default: 0 },
    next_attempt_at: { type: "timestamptz", notNull: true, default: pgm.func("CURRENT_TIMESTAMP") },
    last_error_code: { type: "text" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("CURRENT_TIMESTAMP") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("CURRENT_TIMESTAMP") },
  });

  pgm.addConstraint("storage_cleanup_jobs", "storage_cleanup_jobs_object_reason_unique",
    "UNIQUE (object_key, reason)");
  pgm.addConstraint("storage_cleanup_jobs", "storage_cleanup_jobs_status_check",
    "CHECK (status IN ('pending', 'processing', 'done'))");
  pgm.addConstraint("storage_cleanup_jobs", "storage_cleanup_jobs_attempt_count_check",
    "CHECK (attempt_count >= 0)");
  pgm.createIndex("storage_cleanup_jobs", ["status", "next_attempt_at"], {
    name: "storage_cleanup_jobs_status_next_attempt_idx",
  });
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropTable("storage_cleanup_jobs");
}
