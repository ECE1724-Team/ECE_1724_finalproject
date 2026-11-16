
import type { MigrationBuilder } from "node-pg-migrate";

/**
 * Migration 002: Resumes and Applications
 *
 * DRAFT ONLY — do not execute yet.
 *
 * Confirmed:
 * - Auth identity: public.auth_user.id UUID
 * - Resumes and applications belong to a user
 * - Resume deletion unlinks applications first
 * - Application deletion does not delete library resumes
 *
 * Pending:
 * - Final approval of text_unavailable DB status
 * - Auth migration availability and execution order
 * - Final migration naming and rollback implementation
 */

export async function up(pgm: MigrationBuilder): Promise<void> {
    if (process.env.ENABLE_DRAFT_MIGRATION_002 !== "confirmed") {
        throw new Error(
            "Migration 002 is blocked until dependencies are finalized."
        );
    }

    // =========================================================
    // 1. RESUMES
    // =========================================================

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

    // Same-owner resume references.
    pgm.addConstraint(
        "resumes",
        "resumes_id_user_id_unique",
        "UNIQUE (id, user_id)"
    );

    // Support the user's resume library listing.
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

    // =========================================================
    // 2. RESUME VALIDATION
    // =========================================================

    pgm.addConstraint(
        "resumes",
        "resumes_mime_type_check",
        "CHECK (mime_type = 'application/pdf')"
    );

    // Maximum accepted PDF size: 2 MiB.
    pgm.addConstraint(
        "resumes",
        "resumes_size_bytes_check",
        "CHECK (size_bytes BETWEEN 1 AND 2097152)"
    );

    // Accepted PDFs must contain 1 or 2 pages.
    // Pending and failed rows may not yet have a page count.
    pgm.addConstraint(
        "resumes",
        "resumes_page_count_check",
        "CHECK (page_count IS NULL OR page_count BETWEEN 1 AND 2)"
    );

    // text_unavailable is proposed, pending team approval.
    pgm.addConstraint(
        "resumes",
        "resumes_parse_status_check",
        `CHECK (
            parse_status IN (
                'pending',
                'processing',
                'succeeded',
                'text_unavailable',
                'failed'
            )
        )`
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

    // =========================================================
    // 3. SUCCESSFUL PDF EXTRACTION
    // =========================================================

    // Live succeeded rows require:
    // - a private storage object
    // - a valid page count
    // - extracted text
    // - at least 100 non-whitespace characters
    //
    // Per-page text validation is performed by pdf-policy.ts.
    // Deleted rows may have extracted text cleared.

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

    // =========================================================
    // 4. PDF WITH UNAVAILABLE TEXT
    // =========================================================

    // Proposed behavior:
    //
    // A PDF may be valid and stored successfully even when
    // its extracted text cannot be used by AI.
    //
    // Live text_unavailable rows require:
    // - a stored private object
    // - 1 or 2 pages
    // - no extracted text
    // - no parse error code
    //
    // non_whitespace_chars may retain the measured count.
    //
    // This state is not equivalent to a failed upload.

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
                AND parse_error_code IS NULL
            )
        )`
    );

    // Each stored object key must be unique.
    pgm.createIndex("resumes", "object_key", {
        name: "resumes_object_key_unique_idx",
        unique: true,
        where: "object_key IS NOT NULL",
    });

    // =========================================================
    // 5. APPLICATIONS
    // =========================================================

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

    // =========================================================
    // 6. APPLICATION -> RESUME OWNERSHIP
    // =========================================================

    // A user can link only their own resume.
    //
    // Backend must first set resume_id = NULL on all
    // referencing applications before deleting the resume.
    //
    // Deleting an application never deletes its resume.

    pgm.addConstraint(
        "applications",
        "applications_resume_owner_fk",
        `FOREIGN KEY (resume_id, user_id)
         REFERENCES resumes(id, user_id)
         ON DELETE RESTRICT`
    );

    // Default application list: newest first.
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

    // Filter applications and calculate status counts.
    pgm.createIndex(
        "applications",
        ["user_id", "status"],
        {
            name: "applications_user_status_idx",
        }
    );

    // Sort company names case-insensitively.
    pgm.sql(`
  CREATE INDEX applications_user_company_idx
  ON applications (user_id, lower(company_name), id);
`);

    pgm.createIndex("applications", "resume_id", {
        name: "applications_resume_id_idx",
    });

    // =========================================================
    // 7. APPLICATION VALIDATION
    // =========================================================

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
    throw new Error(
        "Migration 002 rollback is blocked until schema is finalized."
    );
}
