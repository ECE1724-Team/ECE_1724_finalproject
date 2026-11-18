import { withTransaction } from "../../db/transaction.js";
import type { CleanupJob, ParseStatus, ResumeRepository, ResumeRow, StorageCleanupRepository } from "./repository.js";

interface ResumeDbRow {
  id: string;
  user_id: string;
  name: string;
  original_filename: string;
  object_key: string;
  size_bytes: string;
  parse_status: ParseStatus;
  created_at: Date;
  linked_application_count: string | number;
}

function mapResume(row: ResumeDbRow): ResumeRow {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    originalFilename: row.original_filename,
    objectKey: row.object_key,
    sizeBytes: Number(row.size_bytes),
    parseStatus: row.parse_status,
    createdAt: row.created_at,
    linkedApplicationCount: Number(row.linked_application_count),
  };
}

const RESUME_FIELDS = `r.id, r.user_id, r.name, r.original_filename, r.object_key,
                       r.size_bytes, r.parse_status, r.created_at`;

const SELECT_RESUMES = `
  SELECT ${RESUME_FIELDS}, (
    SELECT count(*) FROM public.applications a
    WHERE a.resume_id = r.id AND a.user_id = r.user_id
  ) AS linked_application_count
  FROM public.resumes r
`;

export function createPostgresResumeRepository(cleanup: StorageCleanupRepository): ResumeRepository {
  return {
    async insert(db, row) {
      const { rows } = await db.query<ResumeDbRow>(`
        INSERT INTO public.resumes AS r (
          id, user_id, name, original_filename, object_key, mime_type,
          size_bytes, page_count, non_whitespace_chars, extracted_text, parse_status
        )
        VALUES ($1, $2, $3, $4, $5, 'application/pdf', $6, $7, $8, $9, $10)
        RETURNING ${RESUME_FIELDS}, 0 AS linked_application_count
      `, [
        row.id, row.userId, row.name, row.originalFilename, row.objectKey, row.sizeBytes,
        row.pageCount, row.nonWhitespaceChars, row.extractedText, row.parseStatus,
      ]);
      return mapResume(rows[0]);
    },

    async listLive(db, userId) {
      const { rows } = await db.query<ResumeDbRow>(`
        ${SELECT_RESUMES}
        WHERE r.user_id = $1 AND r.deleted_at IS NULL
        ORDER BY r.created_at DESC, r.id DESC
      `, [userId]);
      return rows.map(mapResume);
    },

    async getLive(db, userId, id) {
      const { rows: [row] } = await db.query<ResumeDbRow>(`
        ${SELECT_RESUMES}
        WHERE r.user_id = $1 AND r.id = $2 AND r.deleted_at IS NULL
      `, [userId, id]);
      return row ? mapResume(row) : null;
    },

    async findLiveByObjectKey(db, objectKey) {
      const { rows: [row] } = await db.query<ResumeDbRow>(`
        ${SELECT_RESUMES}
        WHERE r.object_key = $1 AND r.deleted_at IS NULL
      `, [objectKey]);
      return row ? mapResume(row) : null;
    },

    deleteAndUnlink(pool, userId, id) {
      return withTransaction(pool, async (client) => {
        const { rows: [resume] } = await client.query<{ object_key: string }>(`
          SELECT object_key FROM public.resumes
          WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
          FOR UPDATE
        `, [id, userId]);
        if (!resume) return null;

        // Resume link changes take the resume lock before locking applications.
        await client.query(`
          SELECT id FROM public.applications
          WHERE resume_id = $1 AND user_id = $2
          ORDER BY id
          FOR UPDATE
        `, [id, userId]);

        await client.query(`
          UPDATE public.resumes
          SET deleted_at = statement_timestamp(), updated_at = statement_timestamp(), extracted_text = NULL
          WHERE id = $1 AND user_id = $2
        `, [id, userId]);

        const { rowCount } = await client.query(`
          UPDATE public.applications
          SET resume_id = NULL, row_version = row_version + 1, updated_at = statement_timestamp()
          WHERE resume_id = $1 AND user_id = $2
        `, [id, userId]);

        await cleanup.enqueue(client, resume.object_key, "resume_deleted");
        return { unlinkedApplicationCount: rowCount ?? 0 };
      });
    },
  };
}

export function createPostgresStorageCleanupRepository(): StorageCleanupRepository {
  return {
    async enqueue(db, objectKey, reason) {
      await db.query(`
        INSERT INTO public.storage_cleanup_jobs (object_key, reason)
        VALUES ($1, $2)
        ON CONFLICT (object_key, reason) DO NOTHING
      `, [objectKey, reason]);
    },

    async claimDue(db, limit) {
      const { rows } = await db.query<CleanupJob>(`
        WITH due AS (
          SELECT id FROM public.storage_cleanup_jobs
          WHERE status = 'pending' AND next_attempt_at <= CURRENT_TIMESTAMP
          ORDER BY next_attempt_at, created_at, id
          LIMIT $1
          FOR UPDATE SKIP LOCKED
        )
        UPDATE public.storage_cleanup_jobs AS jobs
        SET status = 'processing', updated_at = CURRENT_TIMESTAMP
        FROM due WHERE jobs.id = due.id
        RETURNING jobs.id, jobs.object_key AS "objectKey", jobs.reason, jobs.attempt_count AS "attemptCount"
      `, [limit]);
      return rows;
    },

    async complete(db, jobId) {
      await db.query(`
        UPDATE public.storage_cleanup_jobs
        SET status = 'done', updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `, [jobId]);
    },

    async fail(db, jobId, errorCode, nextAttemptAt) {
      await db.query(`
        UPDATE public.storage_cleanup_jobs
        SET status = 'pending', attempt_count = attempt_count + 1,
            last_error_code = $2, next_attempt_at = $3, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `, [jobId, errorCode, nextAttemptAt]);
    },

    async requeueProcessing(db) {
      const { rowCount } = await db.query(`
        UPDATE public.storage_cleanup_jobs
        SET status = 'pending', updated_at = CURRENT_TIMESTAMP
        WHERE status = 'processing'
      `);
      return rowCount ?? 0;
    },
  };
}
