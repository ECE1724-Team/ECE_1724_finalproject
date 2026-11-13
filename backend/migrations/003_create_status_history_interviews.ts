
import type { MigrationBuilder } from "node-pg-migrate";

/**
 * Migration 003: Application Status History and Interviews
 *
 * DRAFT ONLY.
 *
 * Prerequisites:
 * 1. Migration 002 must be finalized and applied first.
 * 2. Confirm interview field validation with the backend team.
 *
 * Do not run this migration yet.
 */

export async function up(pgm: MigrationBuilder): Promise<void> {
    if (process.env.ENABLE_DRAFT_MIGRATION_003 !== "confirmed") {
        throw new Error(
            "Migration 003 is blocked until its dependencies are finalized."
        );
    }

    // 1. Application status history
    pgm.createTable("application_status_history", {
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
        sequence_no: {
            type: "bigint",
            notNull: true,
        },
        old_status: {
            type: "text",
            notNull: true,
        },
        new_status: {
            type: "text",
            notNull: true,
        },
        changed_at: {
            type: "timestamptz",
            notNull: true,
            default: pgm.func("CURRENT_TIMESTAMP"),
        },
    });

    // Status values must be valid
    pgm.addConstraint(
        "application_status_history",
        "status_history_old_status_check",
        `CHECK (
            old_status IN (
                'saved', 'applied', 'oa',
                'interview', 'offer', 'rejected'
            )
        )`
    );

    pgm.addConstraint(
        "application_status_history",
        "status_history_new_status_check",
        `CHECK (
            new_status IN (
                'saved', 'applied', 'oa',
                'interview', 'offer', 'rejected'
            )
        )`
    );

    // A status transition must actually change the status
    pgm.addConstraint(
        "application_status_history",
        "status_history_transition_check",
        "CHECK (old_status <> new_status)"
    );

    // Sequence numbers must be positive
    pgm.addConstraint(
        "application_status_history",
        "status_history_sequence_check",
        "CHECK (sequence_no >= 1)"
    );

    // Each application has a unique sequence of changes
    pgm.addConstraint(
        "application_status_history",
        "status_history_application_sequence_unique",
        "UNIQUE (application_id, sequence_no)"
    );

    // Retrieve history in chronological sequence
    pgm.createIndex(
        "application_status_history",
        ["application_id", "changed_at"],
        {
            name: "status_history_application_changed_idx",
        }
    );

    // 2. Interviews
    pgm.createTable("interviews", {
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
        interview_name: {
            type: "text",
        },
        starts_at: {
            type: "timestamptz",
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

    // An interview name cannot contain only spaces
    pgm.addConstraint(
        "interviews",
        "interviews_name_check",
        `CHECK (
            interview_name IS NULL
            OR length(btrim(interview_name)) > 0
        )`
    );

    // Retrieve interviews for an application
    pgm.createIndex("interviews", "application_id", {
        name: "interviews_application_id_idx",
    });

    // Support upcoming interview queries
    pgm.createIndex("interviews", "starts_at", {
        name: "interviews_starts_at_idx",
    });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
    throw new Error(
        "Migration 003 rollback is blocked until schema is finalized."
    );
}

