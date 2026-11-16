
import type { MigrationBuilder } from "node-pg-migrate";

/**
 * Migration 005: AI Persistence
 *
 * DRAFT ONLY — do not execute yet.
 *
 * Based on Database_Design.md sections 5.7–5.10.
 *
 * Requires:
 * - Migration 004: conversations
 *
 * Creates:
 * - generation_runs
 * - messages
 * - material_snapshots
 * - generation_materials
 * - conversation_summaries
 *
 * Does not implement:
 * - AI generation runtime logic
 * - Startup interruption recovery
 * - Material registry validation
 * - Multi-instance lease recovery
 */

export async function up(pgm: MigrationBuilder): Promise<void> {
    if (process.env.ENABLE_DRAFT_MIGRATION_005 !== "confirmed") {
        throw new Error(
            "Migration 005 is blocked until dependencies are finalized."
        );
    }



    // =========================================================
    // 1. GENERATION RUNS
    // =========================================================

    pgm.createTable("generation_runs", {
        id: {
            type: "uuid",
            primaryKey: true,
            default: pgm.func("gen_random_uuid()"),
        },
        conversation_id: {
            type: "uuid",
            notNull: true,
            references: "conversations(id)",
            onDelete: "CASCADE",
        },
        input_message_id: {
            type: "uuid",
            notNull: true,
        },
        status: {
            type: "text",
            notNull: true,
            default: "preparing",
        },
        baseline_generation_id: {
            type: "uuid",
        },
        model_metadata: {
            type: "jsonb",
        },
        error_code: {
            type: "text",
        },
        started_at: {
            type: "timestamptz",
            notNull: true,
            default: pgm.func("CURRENT_TIMESTAMP"),
        },
        snapshot_at: {
            type: "timestamptz",
        },
        completed_at: {
            type: "timestamptz",
        },
    });

    pgm.addConstraint(
        "generation_runs",
        "generation_runs_status_check",
        `CHECK (status IN (
            'preparing',
            'streaming',
            'completed',
            'failed',
            'interrupted'
        ))`
    );

    pgm.addConstraint(
        "generation_runs",
        "generation_runs_lifecycle_check",
        `CHECK (
            (
                status = 'preparing'
                AND snapshot_at IS NULL
                AND completed_at IS NULL
            )
            OR (
                status = 'streaming'
                AND snapshot_at IS NOT NULL
                AND completed_at IS NULL
            )
            OR (
                status = 'completed'
                AND snapshot_at IS NOT NULL
                AND completed_at IS NOT NULL
            )
            OR (
                status IN ('failed', 'interrupted')
                AND completed_at IS NOT NULL
            )
        )`
    );

    pgm.addConstraint(
        "generation_runs",
        "generation_runs_id_conversation_unique",
        "UNIQUE (id, conversation_id)"
    );

    // Only one active generation per conversation.
    pgm.createIndex("generation_runs", "conversation_id", {
        name: "generation_runs_one_active_idx",
        unique: true,
        where: "status IN ('preparing', 'streaming')",
    });

    pgm.createIndex(
        "generation_runs",
        ["input_message_id", "conversation_id"],
        { name: "generation_runs_input_idx" }
    );

    pgm.createIndex(
        "generation_runs",
        [
            "conversation_id",
            { name: "completed_at", sort: "DESC" },
            { name: "id", sort: "DESC" },
        ],
        {
            name: "generation_runs_completed_idx",
            where: "status = 'completed'",
        }
    );

    // Baseline must belong to the same conversation.
    pgm.sql(`
        ALTER TABLE generation_runs
        ADD CONSTRAINT generation_runs_baseline_fk
        FOREIGN KEY (baseline_generation_id, conversation_id)
        REFERENCES generation_runs (id, conversation_id);
    `);

    // =========================================================
    // 2. MESSAGES
    // =========================================================

    pgm.createTable("messages", {
        id: {
            type: "uuid",
            primaryKey: true,
            default: pgm.func("gen_random_uuid()"),
        },
        conversation_id: {
            type: "uuid",
            notNull: true,
            references: "conversations(id)",
            onDelete: "CASCADE",
        },
        generation_id: {
            type: "uuid",
        },
        sequence_no: {
            type: "bigint",
            notNull: true,
        },
        role: {
            type: "text",
            notNull: true,
        },
        parts: {
            type: "jsonb",
            notNull: true,
        },
        created_at: {
            type: "timestamptz",
            notNull: true,
            default: pgm.func("CURRENT_TIMESTAMP"),
        },
    });

    pgm.addConstraint(
        "messages",
        "messages_sequence_positive_check",
        "CHECK (sequence_no >= 1)"
    );

    pgm.addConstraint(
        "messages",
        "messages_role_check",
        "CHECK (role IN ('user', 'assistant', 'tool'))"
    );

    pgm.addConstraint(
        "messages",
        "messages_user_generation_check",
        "CHECK (role <> 'user' OR generation_id IS NULL)"
    );

    pgm.addConstraint(
        "messages",
        "messages_conversation_sequence_unique",
        "UNIQUE (conversation_id, sequence_no)"
    );

    pgm.addConstraint(
        "messages",
        "messages_id_conversation_unique",
        "UNIQUE (id, conversation_id)"
    );

    pgm.sql(`
        ALTER TABLE messages
        ADD CONSTRAINT messages_generation_fk
        FOREIGN KEY (generation_id, conversation_id)
        REFERENCES generation_runs (id, conversation_id);
    `);

    // Add the reverse FK after messages exists.
    pgm.sql(`
        ALTER TABLE generation_runs
        ADD CONSTRAINT generation_runs_input_message_fk
        FOREIGN KEY (input_message_id, conversation_id)
        REFERENCES messages (id, conversation_id);
    `);

    // =========================================================
    // 3. MATERIAL SNAPSHOTS
    // =========================================================

    pgm.createTable("material_snapshots", {
        id: {
            type: "uuid",
            primaryKey: true,
            default: pgm.func("gen_random_uuid()"),
        },
        conversation_id: {
            type: "uuid",
            notNull: true,
            references: "conversations(id)",
            onDelete: "CASCADE",
        },
        kind: {
            type: "text",
            notNull: true,
        },
        fingerprint: {
            type: "text",
            notNull: true,
        },
        source_resume_id: {
            type: "uuid",
        },
        source_label: {
            type: "text",
        },
        availability: {
            type: "text",
            notNull: true,
        },
        content_text: {
            type: "text",
        },
        reason_code: {
            type: "text",
        },
        generation_id: {
            type: "uuid",
            notNull: true,
        },
        created_at: {
            type: "timestamptz",
            notNull: true,
            default: pgm.func("CURRENT_TIMESTAMP"),
        },
    });

    pgm.addConstraint(
        "material_snapshots",
        "material_snapshots_kind_check",
        "CHECK (length(btrim(kind)) > 0)"
    );

    pgm.addConstraint(
        "material_snapshots",
        "material_snapshots_fingerprint_check",
        "CHECK (fingerprint ~ '^v1:[0-9a-f]{64}$')"
    );

    pgm.addConstraint(
        "material_snapshots",
        "material_snapshots_availability_check",
        `CHECK (
            (availability = 'available' AND content_text IS NOT NULL)
            OR
            (availability = 'unavailable' AND content_text IS NULL)
        )`
    );

    pgm.addConstraint(
        "material_snapshots",
        "material_snapshots_identity_unique",
        "UNIQUE (id, conversation_id, kind)"
    );

    pgm.addConstraint(
        "material_snapshots",
        "material_snapshots_version_unique",
        "UNIQUE (conversation_id, kind, fingerprint)"
    );

    pgm.sql(`
        ALTER TABLE material_snapshots
        ADD CONSTRAINT material_snapshots_generation_fk
        FOREIGN KEY (generation_id, conversation_id)
        REFERENCES generation_runs (id, conversation_id);
    `);

    // source_resume_id deliberately has no FK.
    // Historical snapshots survive resume deletion.

    // =========================================================
    // 4. GENERATION MATERIALS
    // =========================================================

    pgm.createTable("generation_materials", {
        generation_id: {
            type: "uuid",
            notNull: true,
        },
        conversation_id: {
            type: "uuid",
            notNull: true,
        },
        kind: {
            type: "text",
            notNull: true,
        },
        snapshot_id: {
            type: "uuid",
            notNull: true,
        },
    });

    pgm.addConstraint(
        "generation_materials",
        "generation_materials_pk",
        "PRIMARY KEY (generation_id, kind)"
    );

    pgm.addConstraint(
        "generation_materials",
        "generation_materials_kind_check",
        "CHECK (length(btrim(kind)) > 0)"
    );

    pgm.sql(`
        ALTER TABLE generation_materials
        ADD CONSTRAINT generation_materials_generation_fk
        FOREIGN KEY (generation_id, conversation_id)
        REFERENCES generation_runs (id, conversation_id)
        ON DELETE CASCADE;
    `);

    pgm.sql(`
        ALTER TABLE generation_materials
        ADD CONSTRAINT generation_materials_snapshot_fk
        FOREIGN KEY (snapshot_id, conversation_id, kind)
        REFERENCES material_snapshots (id, conversation_id, kind);
    `);

    // =========================================================
    // 5. CONVERSATION SUMMARIES
    // =========================================================

    pgm.createTable("conversation_summaries", {
        id: {
            type: "uuid",
            primaryKey: true,
            default: pgm.func("gen_random_uuid()"),
        },
        conversation_id: {
            type: "uuid",
            notNull: true,
            references: "conversations(id)",
            onDelete: "CASCADE",
        },
        through_sequence_no: {
            type: "bigint",
            notNull: true,
        },
        summary_text: {
            type: "text",
            notNull: true,
        },
        previous_summary_id: {
            type: "uuid",
        },
        created_at: {
            type: "timestamptz",
            notNull: true,
            default: pgm.func("CURRENT_TIMESTAMP"),
        },
    });

    pgm.addConstraint(
        "conversation_summaries",
        "conversation_summaries_boundary_check",
        "CHECK (through_sequence_no >= 1)"
    );

    pgm.addConstraint(
        "conversation_summaries",
        "conversation_summaries_boundary_unique",
        "UNIQUE (conversation_id, through_sequence_no)"
    );

    pgm.addConstraint(
        "conversation_summaries",
        "conversation_summaries_identity_unique",
        "UNIQUE (id, conversation_id)"
    );

    pgm.sql(`
        ALTER TABLE conversation_summaries
        ADD CONSTRAINT conversation_summaries_previous_fk
        FOREIGN KEY (previous_summary_id, conversation_id)
        REFERENCES conversation_summaries (id, conversation_id);
    `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
    // Drop dependent tables first.
    pgm.dropTable("conversation_summaries");
    pgm.dropTable("generation_materials");
    pgm.dropTable("material_snapshots");

    // Break the circular FK dependency between
    // generation_runs and messages.
    pgm.dropConstraint(
        "generation_runs",
        "generation_runs_input_message_fk"
    );

    // Drop the remaining tables in dependency order.
    pgm.dropTable("messages");
    pgm.dropTable("generation_runs");
}