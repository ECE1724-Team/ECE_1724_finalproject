import { Router } from "express";
import { getAuthContext } from "../../http/authorization.js";
import type { ApplicationStatus } from "../applications/repository.js";
import { toSummary } from "../applications/service.js";
import type { ApplicationSummaryResource } from "../applications/types.js";
import type { readDashboard } from "./postgres-repository.js";
import { upcomingWindow, type UpcomingWindow } from "./time-window.js";

/** How many recent applications the Dashboard shows (newest first). */
export const RECENT_APPLICATIONS = 5;

export type DashboardRead = (userId: string, options: Parameters<typeof readDashboard>[2]) => ReturnType<typeof readDashboard>;
type DashboardData = Awaited<ReturnType<typeof readDashboard>>;

export interface UpcomingInterviewResource {
  id: string;
  applicationId: string;
  type: string;
  scheduledAt: Date;
  companyName: string;
  jobTitle: string;
}

/** `GET /api/v1/dashboard`. Field names follow the Applications API. */
export interface DashboardResource {
  /** All of the user's applications, saved and rejected ones included (FR-03). */
  counts: { total: number; byStatus: Record<ApplicationStatus, number> };
  /** Applications that ever reached Offer; a later status change does not remove them. */
  offersEverReceived: number;
  /** Every interview round counts separately; not limited to the upcoming window. */
  interviewSessions: number;
  /** "Next 7 days": `start` inclusive, `end` exclusive, in `timeZone`; items in time order. */
  upcomingInterviews: { timeZone: string; start: Date; end: Date; items: UpcomingInterviewResource[] };
  /** The newest applications, at most `RECENT_APPLICATIONS`. */
  recentApplications: ApplicationSummaryResource[];
}

export function toDashboardResource(data: DashboardData, window: UpcomingWindow): DashboardResource {
  return {
    counts: { total: data.totalApplications, byStatus: data.statusCounts },
    offersEverReceived: data.offersEverReceived,
    interviewSessions: data.totalInterviewSessions,
    upcomingInterviews: {
      timeZone: window.timeZone,
      start: window.start,
      end: window.end,
      items: data.upcomingInterviews.map((interview) => ({
        id: interview.id,
        applicationId: interview.applicationId,
        type: interview.interviewName,
        scheduledAt: interview.startsAt,
        companyName: interview.companyName,
        jobTitle: interview.positionTitle,
      })),
    },
    recentApplications: data.recentApplications.map(toSummary),
  };
}

export interface DashboardRouterOptions {
  read: DashboardRead;
  clock?: () => Date;
}

const badRequest = (message: string) => ({ error: { code: "BAD_REQUEST", message } });

/**
 * `/api/v1/dashboard` (PRD FR-03). Mount inside `createApp({ businessRouter })`, which has already
 * run the origin check and `requireVerifiedUser`; the user always comes from `getAuthContext(res)`.
 *
 *   GET /?timeZone=America/Toronto   totals, status counts, next-7-days interviews, recent applications
 *
 * `timeZone` is required: the "Next 7 days" window starts at local midnight in the user's display
 * time zone (the browser's `Intl.DateTimeFormat().resolvedOptions().timeZone`).
 */
export function createDashboardRouter({ read, clock = () => new Date() }: DashboardRouterOptions): Router {
  const router = Router();

  router.get("/", async (req, res) => {
    const { userId } = getAuthContext(res);
    const value = req.query.timeZone;
    if (Array.isArray(value)) { res.status(400).json(badRequest("Send timeZone once.")); return; }
    if (typeof value !== "string" || !value.trim()) {
      res.status(400).json(badRequest("timeZone is required: send the user's IANA time zone, such as America/Toronto."));
      return;
    }
    const window = upcomingWindow(value.trim(), clock());
    if (!window) { res.status(400).json(badRequest("timeZone must be an IANA time zone, such as America/Toronto.")); return; }

    const data = await read(userId, { windowStart: window.start, windowEnd: window.end, recentLimit: RECENT_APPLICATIONS });
    res.json(toDashboardResource(data, window));
  });

  return router;
}
