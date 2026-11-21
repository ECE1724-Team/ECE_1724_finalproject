import { useEffect, useState } from "react";
import { Link } from "react-router";
import { BriefcaseBusiness, CalendarDays, Trophy } from "lucide-react";
import ErrorAlert from "@/components/ErrorAlert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { applicationStatuses } from "@/lib/application-status";
import { responseError } from "@/lib/response-error";
import type { DashboardData } from "@/types";
import styles from "@/styles/Dashboard.module.css";

export default function Dashboard() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function loadDashboard() {
      setError(null);
      setDashboard(null);
      try {
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (!timeZone) throw new Error("Unable to determine your time zone.");
        const query = new URLSearchParams({ timeZone });
        const response = await fetch(`/api/v1/dashboard?${query}`, {
          credentials: "include",
          signal: controller.signal,
        });
        if (!response.ok) throw await responseError(response, "Failed to load dashboard.");
        const result = await response.json() as DashboardData;
        if (!controller.signal.aborted) setDashboard(result);
      } catch (failure) {
        if (!controller.signal.aborted) {
          setError(failure instanceof Error ? failure.message : "Failed to load dashboard.");
        }
      }
    }

    void loadDashboard();
    return () => controller.abort();
  }, [attempt]);

  const statusLabels = Object.fromEntries(applicationStatuses.map(({ value, label }) => [value, label]));

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Dashboard</h1>
        </div>
        <Button nativeButton={false} render={<Link to="/application" />}>New Application</Button>
      </header>

      {error ? (
        <div className={styles.error}>
          <ErrorAlert message={error} />
          <Button variant="outline" onClick={() => setAttempt((current) => current + 1)}>Try again</Button>
        </div>
      ) : !dashboard ? (
        <p role="status">Loading dashboard...</p>
      ) : (
        <>
          <section aria-label="Job search totals" className={styles.stats}>
            <Card>
              <CardHeader><BriefcaseBusiness aria-hidden="true" className={styles.icon} /><CardTitle>Applications</CardTitle></CardHeader>
              <CardContent><p className={styles.statValue}>{dashboard.counts.total}</p><p className={styles.hint}>Includes saved and rejected roles</p></CardContent>
            </Card>
            <Card>
              <CardHeader><CalendarDays aria-hidden="true" className={styles.icon} /><CardTitle>Interview sessions</CardTitle></CardHeader>
              <CardContent><p className={styles.statValue}>{dashboard.interviewSessions}</p><p className={styles.hint}>Each interview round counts</p></CardContent>
            </Card>
            <Card>
              <CardHeader><Trophy aria-hidden="true" className={styles.icon} /><CardTitle>Offers received</CardTitle></CardHeader>
              <CardContent><p className={styles.statValue}>{dashboard.offersEverReceived}</p><p className={styles.hint}>Includes offers previously received</p></CardContent>
            </Card>
          </section>

          <div className={styles.middle}>
            <Card>
              <CardHeader><h2 className={styles.sectionTitle}>Applications by status</h2><p className={styles.hint}>Select a status to see matching roles.</p></CardHeader>
              <CardContent className={styles.statusList}>
                {applicationStatuses.map(({ value, label }) => {
                  const count = dashboard.counts.byStatus[value];
                  const percentage = dashboard.counts.total === 0 ? 0 : (count / dashboard.counts.total) * 100;
                  return (
                    <Link key={value} to={`/applications?status=${value}`} className={styles.statusLink}>
                      <span className={styles.statusHeading}><span>{label}</span><span>{count}</span></span>
                      <span className={styles.bar} aria-hidden="true"><span style={{ width: `${percentage}%` }} /></span>
                    </Link>
                  );
                })}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><h2 className={styles.sectionTitle}>Upcoming interviews</h2><p className={styles.hint}>Next 7 days &middot; {dashboard.upcomingInterviews.timeZone}</p></CardHeader>
              <CardContent>
                {dashboard.upcomingInterviews.items.length === 0 ? (
                  <p className={styles.empty}>No interviews scheduled in the next 7 days.</p>
                ) : (
                  <ul className={styles.rows}>
                    {dashboard.upcomingInterviews.items.map((interview) => (
                      <li key={interview.id} className={styles.row}>
                        <Link className={styles.itemLink} to={`/application/${interview.applicationId}`}>
                          <span className={styles.itemTitle}>{interview.jobTitle}</span>
                          <span className={styles.hint}>{interview.companyName}</span>
                        </Link>
                        <div className={styles.interviewDetails}>
                          <span>{interview.type}</span>
                          <time dateTime={interview.scheduledAt}>
                            {new Date(interview.scheduledAt).toLocaleString(undefined, {
                              timeZone: dashboard.upcomingInterviews.timeZone,
                              dateStyle: "medium",
                              timeStyle: "short",
                            })}
                          </time>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className={styles.recentHeader}>
              <h2 className={styles.sectionTitle}>Recent applications</h2>
              <Link className={styles.viewAll} to="/applications">View all</Link>
            </CardHeader>
            <CardContent>
              {dashboard.recentApplications.length === 0 ? (
                <p className={styles.empty}>No applications yet. Add a role to start tracking your progress.</p>
              ) : (
                <ul className={styles.rows}>
                  {dashboard.recentApplications.map((application) => (
                    <li key={application.id}>
                      <Link className={styles.recentLink} to={`/application/${application.id}`}>
                        <span className={styles.itemLink}>
                          <span className={styles.itemTitle}>{application.jobTitle}</span>
                          <span className={styles.hint}>{application.companyName}</span>
                        </span>
                        <span className={styles.badge}>{statusLabels[application.status]}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </main>
  );
}
