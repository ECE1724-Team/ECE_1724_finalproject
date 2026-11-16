
import type { MigrationBuilder } from "node-pg-migrate";

/**
 * Migration 004: AI Workspaces and Conversations
 *
 * DRAFT ONLY — do not execute yet.
 *
 * Confirmed:
 * - Each application has at most one AI workspace.
 * - Each workspace can contain multiple conversations.
 * - Application hard deletion cascades to AI data.
 *
 * Pending:
 * - Final migration naming and execution order.
 * - Auth and business migration integration testing.
 * - Generation lifecycle and concurrency handling.
 */

export async function up(pgm: MigrationBuilder): Promise<void> {
    if (process.env.ENABLE_DRAFT_MIGRATION_004 !== "confirmed") {
        throw new Error(
            "Migration 004 is blocked until dependencies are finalized."
        );
    }

    // =========================================================
    // 1. AI WORKSPACES
    // =========================================================

    // Each application can have at most one AI workspace.
    // Deleting an application deletes its workspace.
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
            onDelete: "CASCADE",
        },
        created_at: {
            type: "timestamptz",
            notNull: true,
            default: pgm.func("CURRENT_TIMESTAMP"),
        },
    });

    // Prevent multiple workspaces for the same application.
    pgm.addConstraint(
        "ai_workspaces",
        "ai_workspaces_application_unique",
        "UNIQUE (application_id)"
    );

    // =========================================================
    // 2. CONVERSATIONS
    // =========================================================

    // Each workspace may contain multiple conversations.
    // Deleting a workspace deletes its conversations.
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
            onDelete: "CASCADE",
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

    // =========================================================
    // 3. CONVERSATION VALIDATION
    // =========================================================

    // Sequence numbers begin at 1.
    pgm.addConstraint(
        "conversations",
        "conversations_next_sequence_no_check",
        "CHECK (next_sequence_no >= 1)"
    );

    // Optional titles must not contain only whitespace.
    pgm.addConstraint(
        "conversations",
        "conversations_title_check",
        "CHECK (title IS NULL OR length(btrim(title)) > 0)"
    );

    // =========================================================
    // 4. INDEXES
    // =========================================================

    // Retrieve conversations by workspace and creation time.
    // List conversations by most recent activity.
    pgm.createIndex(
        "conversations",
        [
            "workspace_id",
            { name: "updated_at", sort: "DESC" },
            "id",
        ],
        {
            name: "conversations_workspace_updated_idx",
        }
    );
}

export async function down(pgm: MigrationBuilder): Promise<void> {
    throw new Error(
        "Migration 004 rollback is blocked until schema is finalized."
    );
}
