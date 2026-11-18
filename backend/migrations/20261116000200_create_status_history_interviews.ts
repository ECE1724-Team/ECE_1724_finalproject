import type { MigrationBuilder } from "node-pg-migrate";

/**
 * Application status history and interviews. See Database_Design.md §5.4, §5.5.
 */

export async function up(pgm: MigrationBuilder): Promise<void> {
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

    pgm.addConstraint(
        "application_status_history",
        "status_history_transition_check",
        "CHECK (old_status <> new_status)"
    );

    pgm.addConstraint(
        "application_status_history",
        "status_history_sequence_check",
        "CHECK (sequence_no >= 1)"
    );

    pgm.addConstraint(
        "application_status_history",
        "status_history_application_sequence_unique",
        "UNIQUE (application_id, sequence_no)"
    );

    pgm.createIndex(
        "application_status_history",
        ["application_id", "changed_at"],
        {
            name: "status_history_application_changed_idx",
        }
    );

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
            notNull: true,
        },
        starts_at: {
            type: "timestamptz",
            notNull: true,
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

    pgm.addConstraint(
        "interviews",
        "interviews_name_check",
        `CHECK (
        interview_name = btrim(interview_name)
        AND char_length(interview_name) BETWEEN 1 AND 100
    )`
    );

    pgm.createIndex(
        "interviews",
        ["application_id", "starts_at", "id"],
        {
            name: "interviews_application_starts_id_idx",
        }
    );

    pgm.createIndex(
        "interviews",
        ["starts_at", "application_id"],
        {
            name: "interviews_starts_application_idx",
        }
    );
}

export async function down(pgm: MigrationBuilder): Promise<void> {
    pgm.dropTable("interviews");
    pgm.dropTable("application_status_history");
}
