import type { PoolClient } from "pg";
import { withTransaction } from "../../db/transaction.js";
import type {
  ApplicationCounts, ApplicationDetailRow, ApplicationListRow, ApplicationRepository, ApplicationRow, ApplicationStatus,
  ApplicationStatusHistoryRepository, ApplicationStatusHistoryRow, ApplicationUpdate, Db, InterviewRepository, InterviewRow,
} from "./repository.js";

const APPLICATION_LIST_FIELDS = `id, company_name AS "companyName",
  position_title AS "positionTitle", status, to_char(applied_date, 'YYYY-MM-DD') AS "appliedDate",
  resume_id AS "resumeId", row_version::text AS "rowVersion", created_at AS "createdAt"`;
const APPLICATION_FIELDS = `${APPLICATION_LIST_FIELDS}, user_id AS "userId", job_description AS "jobDescription", job_url AS "jobUrl",
  company_website_url AS "companyWebsiteUrl", company_notes AS "companyNotes", personal_notes AS "personalNotes",
  offer_received AS "offerReceived", updated_at AS "updatedAt"`;
const LIVE_RESUME_NAME = `(SELECT r.name FROM public.resumes r
  WHERE r.id = a.resume_id AND r.user_id = a.user_id AND r.deleted_at IS NULL) AS "resumeName"`;

const EDITABLE_COLUMNS = {
  companyName: "company_name",
  positionTitle: "position_title",
  status: "status",
  appliedDate: "applied_date",
  jobDescription: "job_description",
  resumeId: "resume_id",
  jobUrl: "job_url",
  companyWebsiteUrl: "company_website_url",
  companyNotes: "company_notes",
  personalNotes: "personal_notes",
  offerReceived: "offer_received",
} satisfies Record<keyof ApplicationUpdate, string>;

const ACTIVE_GENERATION = Symbol("GENERATION_ACTIVE");

function inTransaction<T>(db: Db, run: (client: PoolClient) => Promise<T>): Promise<T> {
  return "release" in db ? run(db) : withTransaction(db, run);
}

async function findApplication(db: Db, userId: string, id: string, lock = false): Promise<ApplicationRow | null> {
  const { rows: [row] } = await db.query<ApplicationRow>(`
    SELECT ${APPLICATION_FIELDS} FROM public.applications
    WHERE user_id = $1 AND id = $2 ${lock ? "FOR UPDATE" : ""}
  `, [userId, id]);
  return row ?? null;
}

async function lockResumeSelection(client: PoolClient, userId: string, oldId: string | null, newId: string | null) {
  const ids = [oldId, newId].filter((id) => id !== null);
  const { rows } = await client.query<{ id: string; eligible: boolean }>(`
    SELECT id, (deleted_at IS NULL AND parse_status IN ('succeeded', 'text_unavailable')
        AND nullif(btrim(object_key), '') IS NOT NULL) AS eligible
    FROM public.resumes WHERE user_id = $1 AND id = ANY($2::uuid[])
    ORDER BY id FOR UPDATE
  `, [userId, ids]);
  return newId === null || rows.some(({ id, eligible }) => id === newId && eligible);
}

export function createPostgresApplicationRepository(): ApplicationRepository {
  return {
    insert(db, application) {
      return inTransaction(db, async (client) => {
        const resumeId = application.resumeId?.toLowerCase() ?? null;
        if (resumeId !== null && !(await lockResumeSelection(client, application.userId, null, resumeId))) {
          return { outcome: "RESUME_INELIGIBLE" };
        }

        const status = application.status ?? "saved";
        const { rows: [row] } = await client.query<ApplicationRow>(`
          INSERT INTO public.applications (
            id, user_id, company_name, position_title, status, applied_date, job_description, resume_id,
            job_url, company_website_url, company_notes, personal_notes, offer_received
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          RETURNING ${APPLICATION_FIELDS}
        `, [
          application.id, application.userId, application.companyName.trim(), application.positionTitle.trim(),
          status, application.appliedDate ?? null, application.jobDescription ?? null, resumeId,
          application.jobUrl ?? null, application.companyWebsiteUrl ?? null, application.companyNotes ?? null,
          application.personalNotes ?? null, status === "offer" || (application.offerReceived ?? false),
        ]);
        return { outcome: "OK", application: row };
      });
    },

    async get(db, userId, id) {
      const { rows: [row] } = await db.query<ApplicationDetailRow>(`
        SELECT ${APPLICATION_FIELDS}, ${LIVE_RESUME_NAME} FROM public.applications a
        WHERE a.user_id = $1 AND a.id = $2
      `, [userId, id]);
      return row ?? null;
    },

    async list(db, userId, options = {}) {
      const term = options.search?.trim();
      const pattern = term ? `%${term.replace(/[!%_]/g, "!$&")}%` : null;
      const order = options.sort === "company" ? "lower(a.company_name), a.id" : "a.created_at DESC, a.id DESC";
      const { rows } = await db.query<ApplicationListRow>(`
        SELECT ${APPLICATION_LIST_FIELDS}, ${LIVE_RESUME_NAME} FROM public.applications a
        WHERE a.user_id = $1 AND ($2::text IS NULL OR a.status = $2)
          AND ($3::text IS NULL OR a.company_name ILIKE $3 ESCAPE '!' OR a.position_title ILIKE $3 ESCAPE '!')
        ORDER BY ${order}
        LIMIT $4
      `, [userId, options.status ?? null, pattern, options.limit ?? null]);
      return rows;
    },

    async counts(db, userId) {
      const { rows } = await db.query<{ status: ApplicationStatus; count: string; offers: string }>(`
        SELECT status, count(*), count(*) FILTER (WHERE offer_received) AS offers
        FROM public.applications WHERE user_id = $1 GROUP BY status
      `, [userId]);
      const counts: ApplicationCounts = {
        statusCounts: { saved: 0, applied: 0, oa: 0, interview: 0, offer: 0, rejected: 0 },
        totalApplications: 0,
        offersEverReceived: 0,
      };
      for (const row of rows) {
        const count = Number(row.count);
        counts.statusCounts[row.status] = count;
        counts.totalApplications += count;
        counts.offersEverReceived += Number(row.offers);
      }
      return counts;
    },

    update(db, userId, id, expectedRowVersion, changes) {
      return inTransaction(db, async (client) => {
        const resumeId = changes.resumeId?.toLowerCase() ?? changes.resumeId;
        let oldResumeId: string | null | undefined;
        let resumeEligible = true;
        if (resumeId !== undefined) {
          const beforeLock = await findApplication(client, userId, id);
          if (!beforeLock) return { outcome: "NOT_FOUND" };
          oldResumeId = beforeLock.resumeId;
          // Match resume deletion: take all required resume locks in ID order before the application lock.
          if (oldResumeId !== resumeId) resumeEligible = await lockResumeSelection(client, userId, oldResumeId, resumeId);
        }

        const current = await findApplication(client, userId, id, true);
        if (!current) return { outcome: "NOT_FOUND" };
        const staleVersion = expectedRowVersion !== undefined && expectedRowVersion !== current.rowVersion;
        const relinked = oldResumeId !== undefined && oldResumeId !== current.resumeId;
        if (staleVersion || relinked) return { outcome: "VERSION_CONFLICT" };
        if (!resumeEligible) return { outcome: "RESUME_INELIGIBLE" };

        const patch = {
          ...changes, resumeId,
          companyName: changes.companyName?.trim(), positionTitle: changes.positionTitle?.trim(),
          offerReceived: changes.status === "offer" && current.status !== "offer" ? true : changes.offerReceived,
        };
        const values: unknown[] = [userId, id];
        const assignments: string[] = [];
        const comparisons: string[] = [];
        for (const field of Object.keys(EDITABLE_COLUMNS) as (keyof ApplicationUpdate)[]) {
          if (patch[field] === undefined) continue;
          values.push(patch[field]);
          const parameter = `$${values.length}`;
          const column = EDITABLE_COLUMNS[field];
          assignments.push(`${column} = ${parameter}`);
          comparisons.push(`${column} IS DISTINCT FROM ${parameter}`);
        }
        if (!assignments.length) return { outcome: "OK", application: current };

        const { rows: [updated] } = await client.query<ApplicationRow>(`
          UPDATE public.applications
          SET ${assignments.join(", ")}, row_version = row_version + 1, updated_at = statement_timestamp()
          WHERE user_id = $1 AND id = $2 AND (${comparisons.join(" OR ")})
          RETURNING ${APPLICATION_FIELDS}
        `, values);
        if (!updated) return { outcome: "OK", application: current };

        if (current.status !== updated.status) {
          await client.query(`
            INSERT INTO public.application_status_history (application_id, sequence_no, old_status, new_status, changed_at)
            SELECT $1, COALESCE(max(sequence_no), 0) + 1, $2, $3, statement_timestamp()
            FROM public.application_status_history WHERE application_id = $1
          `, [id, current.status, updated.status]);
        }
        return { outcome: "OK", application: updated };
      });
    },

    async delete(pool, userId, id) {
      try {
        return await withTransaction(pool, async (client) => {
          await client.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
          const { rows: [application] } = await client.query(`
            SELECT id FROM public.applications WHERE user_id = $1 AND id = $2 FOR UPDATE
          `, [userId, id]);
          if (!application) return "NOT_FOUND";

          const { rows: [workspace] } = await client.query<{ id: string }>(`
            SELECT id FROM public.ai_workspaces WHERE application_id = $1 FOR UPDATE
          `, [id]);
          if (workspace) {
            await client.query(`
              SELECT id FROM public.conversations WHERE workspace_id = $1 ORDER BY id FOR UPDATE
            `, [workspace.id]);
            // Read after acquiring the locks so this sees any generation acceptance that just committed.
            const { rows: [active] } = await client.query(`
              SELECT 1 FROM public.generation_runs g
              JOIN public.conversations c ON c.id = g.conversation_id
              WHERE c.workspace_id = $1 AND g.status IN ('preparing', 'streaming') LIMIT 1
            `, [workspace.id]);
            if (active) throw ACTIVE_GENERATION;
          }

          await client.query("DELETE FROM public.applications WHERE user_id = $1 AND id = $2", [userId, id]);
          return "DELETED";
        });
      } catch (error) {
        if (error === ACTIVE_GENERATION) return "GENERATION_ACTIVE";
        throw error;
      }
    },
  };
}

export function createPostgresApplicationStatusHistoryRepository(): ApplicationStatusHistoryRepository {
  return {
    async list(db, userId, applicationId) {
      const { rows } = await db.query<ApplicationStatusHistoryRow>(`
        SELECT h.id, h.application_id AS "applicationId", h.sequence_no::text AS "sequenceNo",
               h.old_status AS "oldStatus", h.new_status AS "newStatus", h.changed_at AS "changedAt"
        FROM public.application_status_history h JOIN public.applications a ON a.id = h.application_id
        WHERE a.user_id = $1 AND a.id = $2 ORDER BY h.sequence_no
      `, [userId, applicationId]);
      return rows;
    },
  };
}

const INTERVIEW_FIELDS = `i.id, i.application_id AS "applicationId", i.interview_name AS "interviewName",
  i.starts_at AS "startsAt", i.created_at AS "createdAt", i.updated_at AS "updatedAt"`;
const SELECT_INTERVIEWS = `SELECT ${INTERVIEW_FIELDS} FROM public.interviews i
  JOIN public.applications a ON a.id = i.application_id WHERE a.user_id = $1 AND a.id = $2`;

export function createPostgresInterviewRepository(): InterviewRepository {
  const get: InterviewRepository["get"] = async (db, userId, applicationId, interviewId) => {
    const { rows: [row] } = await db.query<InterviewRow>(`${SELECT_INTERVIEWS} AND i.id = $3`, [userId, applicationId, interviewId]);
    return row ?? null;
  };

  return {
    async insert(db, interview) {
      const { rows: [row] } = await db.query<InterviewRow>(`
        INSERT INTO public.interviews AS i (id, application_id, interview_name, starts_at)
        SELECT $1, a.id, $4, $5 FROM public.applications a
        WHERE a.id = $2 AND a.user_id = $3 FOR KEY SHARE OF a
        RETURNING ${INTERVIEW_FIELDS}
      `, [interview.id, interview.applicationId, interview.userId, interview.interviewName.trim(), interview.startsAt]);
      return row ?? null;
    },

    async list(db, userId, applicationId) {
      const { rows } = await db.query<InterviewRow>(`${SELECT_INTERVIEWS} ORDER BY i.starts_at, i.id`, [userId, applicationId]);
      return rows;
    },

    get,

    async update(db, userId, applicationId, interviewId, changes) {
      const values: unknown[] = [userId, applicationId, interviewId];
      const assignments: string[] = [];
      if (changes.interviewName !== undefined) {
        values.push(changes.interviewName.trim());
        assignments.push(`interview_name = $${values.length}`);
      }
      if (changes.startsAt !== undefined) {
        values.push(changes.startsAt);
        assignments.push(`starts_at = $${values.length}`);
      }
      if (!assignments.length) return get(db, userId, applicationId, interviewId);

      const { rows: [row] } = await db.query<InterviewRow>(`
        UPDATE public.interviews i SET ${assignments.join(", ")}, updated_at = statement_timestamp()
        FROM public.applications a WHERE i.application_id = a.id AND a.user_id = $1 AND a.id = $2 AND i.id = $3
        RETURNING ${INTERVIEW_FIELDS}
      `, values);
      return row ?? null;
    },

    async delete(db, userId, applicationId, interviewId) {
      const { rowCount } = await db.query(`
        DELETE FROM public.interviews i USING public.applications a
        WHERE i.application_id = a.id AND a.user_id = $1 AND a.id = $2 AND i.id = $3
      `, [userId, applicationId, interviewId]);
      return rowCount === 1;
    },
  };
}
