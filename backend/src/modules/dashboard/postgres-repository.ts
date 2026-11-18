import type { Pool } from "pg";
import { withTransaction } from "../../db/transaction.js";
import { createPostgresApplicationRepository } from "../applications/postgres-repository.js";

interface DashboardOptions {
  windowStart: Date;
  windowEnd: Date;
  recentLimit?: number;
}

interface UpcomingInterview {
  id: string;
  applicationId: string;
  interviewName: string;
  companyName: string;
  positionTitle: string;
  startsAt: Date;
}

const applications = createPostgresApplicationRepository();

/** The caller supplies the two local-midnight boundaries as instants. */
export function readDashboard(pool: Pool, userId: string, options: DashboardOptions) {
  return withTransaction(pool, async (client) => {
    await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    const counts = await applications.counts(client, userId);
    const { rows: [{ count }] } = await client.query<{ count: string }>(`
      SELECT count(*) FROM public.interviews i JOIN public.applications a ON a.id = i.application_id
      WHERE a.user_id = $1
    `, [userId]);
    const { rows: upcomingInterviews } = await client.query<UpcomingInterview>(`
      SELECT i.id, a.id AS "applicationId", i.interview_name AS "interviewName", i.starts_at AS "startsAt",
             a.company_name AS "companyName", a.position_title AS "positionTitle"
      FROM public.interviews i JOIN public.applications a ON a.id = i.application_id
      WHERE a.user_id = $1 AND i.starts_at >= $2 AND i.starts_at < $3
      ORDER BY i.starts_at, i.id
    `, [userId, options.windowStart, options.windowEnd]);
    const recentApplications = await applications.list(client, userId, { limit: options.recentLimit });

    return { ...counts, totalInterviewSessions: Number(count), upcomingInterviews, recentApplications };
  });
}
