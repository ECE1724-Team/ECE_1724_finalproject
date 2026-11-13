
import type { MigrationBuilder } from "node-pg-migrate";

/**
 * Migration 004: AI Workspaces and Conversations
 *
 * DRAFT ONLY.
 *
 * Prerequisites:
 * 1. Migration 002 must be finalized and applied.
 * 2. Application ownership must be enforced by backend APIs.
 * 3. Confirm application deletion and retention policy.
 *
 * Do not run this migration yet.
 */

export async function up(pgm: MigrationBuilder): Promise<void> {
    if (process.env.ENABLE_DRAFT_MIGRATION_004 !== "confirmed") {
        throw new Error(
            "Migration 004 is blocked until dependencies are finalized."
        );
    }

    // 1. One AI workspace per application
    pgm.createTable("ai_workspaces", {
        id: {
            type: "uuid",
            primaryKey: true,
            default: pgm.func("gen_random_uuid()"),
        },
        application_id: {
            type: "uuid",
            notNull: true,
            references: "applications(id)",
            onDelete: "RESTRICT",
        },
        created_at: {
            type: "timestamptz",
            notNull: true,
            default: pgm.func("CURRENT_TIMESTAMP"),
        },
    });

    // Prevent duplicate workspaces for one application
    pgm.addConstraint(
        "ai_workspaces",
        "ai_workspaces_application_unique",
        "UNIQUE (application_id)"
    );

    // 2. Independent conversations in each workspace
    pgm.createTable("conversations", {
        id: {
            type: "uuid",
            primaryKey: true,
            default: pgm.func("gen_random_uuid()"),
        },
        workspace_id: {
            type: "uuid",
            notNull: true,
            references: "ai_workspaces(id)",
            onDelete: "RESTRICT",
        },
        title: {
            type: "text",
        },
        next_sequence_no: {
            type: "bigint",
            notNull: true,
            default: 1,
        },
        created_at: {
            type: "timestamptz",
            notNull: true,
            default: pgm.func("CURRENT_TIMESTAMP"),
        },
        updated_at: {
            type: "timestamptz",
            notNull: true,
            default: pgm.func("CURRENT_TIMESTAMP"),
        },
    });

    // Sequence allocation starts at 1
    pgm.addConstraint(
        "conversations",
        "conversations_next_sequence_no_check",
        "CHECK (next_sequence_no >= 1)"
    );

    // Optional title must not contain only spaces
    pgm.addConstraint(
        "conversations",
        "conversations_title_check",
        "CHECK (title IS NULL OR length(btrim(title)) > 0)"
    );

    // Find conversations belonging to a workspace
    pgm.createIndex(
        "conversations",
        ["workspace_id", "created_at"],
        {
            name: "conversations_workspace_created_idx",
        }
    );
}

export async function down(pgm: MigrationBuilder): Promise<void> {
    throw new Error(
        "Migration 004 rollback is blocked until schema is finalized."
    );
}
