import type { MigrationBuilder } from "node-pg-migrate";

/**
 * AI workspaces and conversations. See Database_Design.md §5.6.
 */

export async function up(pgm: MigrationBuilder): Promise<void> {
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

    pgm.addConstraint(
        "ai_workspaces",
        "ai_workspaces_application_unique",
        "UNIQUE (application_id)"
    );

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

    pgm.addConstraint(
        "conversations",
        "conversations_next_sequence_no_check",
        "CHECK (next_sequence_no >= 1)"
    );

    pgm.addConstraint(
        "conversations",
        "conversations_title_check",
        "CHECK (title IS NULL OR length(btrim(title)) > 0)"
    );

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
    pgm.dropTable("conversations");
    pgm.dropTable("ai_workspaces");
}
