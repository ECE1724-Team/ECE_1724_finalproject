
import type { MigrationBuilder } from "node-pg-migrate";

/**
 * Migration 002: Resumes and Applications
 *
 * DRAFT ONLY.
 *
 * Before enabling this migration:
 * 1. Confirm the Auth user table name.
 * 2. Confirm the Auth user primary-key type.
 * 3. Add the user_id columns and ownership foreign keys.
 * 4. Confirm Auth migrations run first.
 *
 * Do not run this migration yet.
 */

export async function up(pgm: MigrationBuilder): Promise<void> {
    if (process.env.ENABLE_DRAFT_MIGRATION_002 !== "confirmed") {
        throw new Error(
            "Migration 002 is blocked until Auth dependencies are finalized."
        );
    }

    // Planned schema: resumes
    pgm.createTable("resumes", {
        id: {
            type: "uuid",
            primaryKey: true,
            default: pgm.func("gen_random_uuid()"),
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
            default: "pending",
        },
        parse_error_code: {
            type: "text",
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

    // Resume validation constraints
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

    pgm.addConstraint(
        "resumes",
        "resumes_parse_status_check",
        "CHECK (parse_status IN ('pending', 'processing', 'succeeded', 'failed'))"
    );

    pgm.addConstraint(
        "resumes",
        "resumes_content_version_check",
        "CHECK (content_version >= 1)"
    );

    // Resume name must contain non-whitespace characters
    pgm.addConstraint(
        "resumes",
        "resumes_name_check",
        "CHECK (length(btrim(name)) > 0)"
    );

    // Original filename must not be blank
    pgm.addConstraint(
        "resumes",
        "resumes_original_filename_check",
        "CHECK (length(btrim(original_filename)) > 0)"
    );

    // Extracted character count cannot be negative
    pgm.addConstraint(
        "resumes",
        "resumes_non_whitespace_chars_check",
        "CHECK (non_whitespace_chars IS NULL OR non_whitespace_chars >= 0)"
    );

    // Successfully parsed resumes require valid extracted data

    pgm.addConstraint(
        "resumes",
        "resumes_succeeded_check",
        `CHECK (
            parse_status <> 'succeeded'
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



    // Each stored resume object must have a unique storage key
    pgm.createIndex("resumes", "object_key", {
        name: "resumes_object_key_unique_idx",
        unique: true,
        where: "object_key IS NOT NULL",
    });


    // Planned schema: applications
    pgm.createTable("applications", {
        id: {
            type: "uuid",
            primaryKey: true,
            default: pgm.func("gen_random_uuid()"),
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


    // Application validation constraints
    pgm.addConstraint(
        "applications",
        "applications_status_check",
        "CHECK (status IN ('saved', 'applied', 'oa', 'interview', 'offer', 'rejected'))"
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
    // Find applications associated with a resume
    pgm.createIndex("applications", "resume_id", {
        name: "applications_resume_id_idx",
    });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
    throw new Error(
        "Migration 002 rollback is blocked until schema is finalized."
    );
}
