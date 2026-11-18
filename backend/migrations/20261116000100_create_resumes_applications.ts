import type { MigrationBuilder } from "node-pg-migrate";

/**
 * Resumes and applications. See Database_Design.md §5.2, §5.3.
 */

export async function up(pgm: MigrationBuilder): Promise<void> {
    pgm.createTable("resumes", {
        id: {
            type: "uuid",
            primaryKey: true,
            default: pgm.func("gen_random_uuid()"),
        },
        user_id: {
            type: "uuid",
            notNull: true,
            references: "public.auth_user(id)",
            onDelete: "RESTRICT",
        },
        name: {
            type: "text",
            notNull: true,
        },
        original_filename: {
            type: "text",
            notNull: true,
        },
        object_key: {
            type: "text",
        },
        mime_type: {
            type: "text",
            notNull: true,
        },
        size_bytes: {
            type: "bigint",
            notNull: true,
        },
        page_count: {
            type: "integer",
        },
        extracted_text: {
            type: "text",
        },
        non_whitespace_chars: {
            type: "integer",
        },
        parse_status: {
            type: "text",
            notNull: true,
        },
        content_version: {
            type: "bigint",
            notNull: true,
            default: 1,
        },
        deleted_at: {
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

    // Target of the applications (resume_id, user_id) FK.
    pgm.addConstraint(
        "resumes",
        "resumes_id_user_id_unique",
        "UNIQUE (id, user_id)"
    );

    pgm.createIndex(
        "resumes",
        [
            "user_id",
            { name: "created_at", sort: "DESC" },
            "id",
        ],
        {
            name: "resumes_user_created_id_idx",
        }
    );

    pgm.addConstraint(
        "resumes",
        "resumes_mime_type_check",
        "CHECK (mime_type = 'application/pdf')"
    );

    pgm.addConstraint(
        "resumes",
        "resumes_size_bytes_check",
        "CHECK (size_bytes BETWEEN 1 AND 2097152)"
    );

    pgm.addConstraint(
        "resumes",
        "resumes_page_count_check",
        "CHECK (page_count IS NULL OR page_count BETWEEN 1 AND 2)"
    );

    // Rejected uploads create no row, so there is no pending or failed state.
    pgm.addConstraint(
        "resumes",
        "resumes_parse_status_check",
        "CHECK (parse_status IN ('succeeded', 'text_unavailable'))"
    );

    pgm.addConstraint(
        "resumes",
        "resumes_content_version_check",
        "CHECK (content_version >= 1)"
    );

    pgm.addConstraint(
        "resumes",
        "resumes_name_check",
        "CHECK (length(btrim(name)) > 0)"
    );

    pgm.addConstraint(
        "resumes",
        "resumes_original_filename_check",
        "CHECK (length(btrim(original_filename)) > 0)"
    );

    pgm.addConstraint(
        "resumes",
        "resumes_non_whitespace_chars_check",
        `CHECK (
            non_whitespace_chars IS NULL
            OR non_whitespace_chars >= 0
        )`
    );

    // Deleted rows are exempt so their text can be cleared (§7.3).
    // The per-page text rule is enforced in pdf-policy.ts.

    pgm.addConstraint(
        "resumes",
        "resumes_succeeded_check",
        `CHECK (
            deleted_at IS NOT NULL
            OR parse_status <> 'succeeded'
            OR (
                object_key IS NOT NULL
                AND length(btrim(object_key)) > 0
                AND page_count IS NOT NULL
                AND page_count BETWEEN 1 AND 2
                AND extracted_text IS NOT NULL
                AND non_whitespace_chars IS NOT NULL
                AND non_whitespace_chars >= 100
            )
        )`
    );

    pgm.addConstraint(
        "resumes",
        "resumes_text_unavailable_check",
        `CHECK (
            deleted_at IS NOT NULL
            OR parse_status <> 'text_unavailable'
            OR (
                object_key IS NOT NULL
                AND length(btrim(object_key)) > 0
                AND page_count IS NOT NULL
                AND page_count BETWEEN 1 AND 2
                AND extracted_text IS NULL
            )
        )`
    );

    pgm.createIndex("resumes", "object_key", {
        name: "resumes_object_key_unique_idx",
        unique: true,
        where: "object_key IS NOT NULL",
    });

    pgm.createTable("applications", {
        id: {
            type: "uuid",
            primaryKey: true,
            default: pgm.func("gen_random_uuid()"),
        },
        user_id: {
            type: "uuid",
            notNull: true,
            references: "public.auth_user(id)",
            onDelete: "RESTRICT",
        },
        company_name: {
            type: "text",
            notNull: true,
        },
        position_title: {
            type: "text",
            notNull: true,
        },
        status: {
            type: "text",
            notNull: true,
            default: "saved",
        },
        applied_date: {
            type: "date",
        },
        job_description: {
            type: "text",
        },
        resume_id: {
            type: "uuid",
        },
        job_url: {
            type: "text",
        },
        company_website_url: {
            type: "text",
        },
        company_notes: {
            type: "text",
        },
        personal_notes: {
            type: "text",
        },
        offer_received: {
            type: "boolean",
            notNull: true,
            default: false,
        },
        row_version: {
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

    // The backend unlinks applications before deleting a resume (§7.3).

    pgm.addConstraint(
        "applications",
        "applications_resume_owner_fk",
        `FOREIGN KEY (resume_id, user_id)
         REFERENCES resumes(id, user_id)
         ON DELETE RESTRICT`
    );

    pgm.createIndex(
        "applications",
        [
            "user_id",
            { name: "created_at", sort: "DESC" },
            { name: "id", sort: "DESC" },
        ],
        {
            name: "applications_user_created_id_idx",
        }
    );

    pgm.createIndex(
        "applications",
        ["user_id", "status"],
        {
            name: "applications_user_status_idx",
        }
    );

    pgm.sql(`
  CREATE INDEX applications_user_company_idx
  ON applications (user_id, lower(company_name), id);
`);

    pgm.createIndex("applications", "resume_id", {
        name: "applications_resume_id_idx",
    });

    pgm.addConstraint(
        "applications",
        "applications_status_check",
        `CHECK (
            status IN (
                'saved',
                'applied',
                'oa',
                'interview',
                'offer',
                'rejected'
            )
        )`
    );

    pgm.addConstraint(
        "applications",
        "applications_company_name_check",
        "CHECK (length(btrim(company_name)) > 0)"
    );

    pgm.addConstraint(
        "applications",
        "applications_position_title_check",
        "CHECK (length(btrim(position_title)) > 0)"
    );

    pgm.addConstraint(
        "applications",
        "applications_row_version_check",
        "CHECK (row_version >= 1)"
    );
}

export async function down(pgm: MigrationBuilder): Promise<void> {
    pgm.dropTable("applications");
    pgm.dropTable("resumes");
}
