import { useEffect, useState } from "react";
import ErrorAlert from "@/components/ErrorAlert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link, useSearchParams } from "react-router";
import type { ApplicationList, ApplicationSummary } from "../types";
import { fakeApplications } from "../lib/testpayloads";
import { responseError } from "@/lib/response-error";
import { applicationStatuses } from "@/lib/application-status";
import styles from "@/styles/Applications.module.css";

const PAGE_SIZE = 20;

export default function Applications({ mock = false }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const status = searchParams.get("status");
  const [applications, setApplications] = useState<ApplicationSummary[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadApplications() {
      setLoading(true);
      setError(null);
      setPage(1);

      try {
        const query = new URLSearchParams({ sort: "newest" });
        if (status) query.set("status", status);
        const response = await fetch(
          `/api/v1/applications?${query}`,
          {
            credentials: "include",
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          throw await responseError(response, "Failed to load applications.");
        }

        const result = await response.json() as ApplicationList;
        if (!controller.signal.aborted) {
          setApplications(result.data);
          setTotal(result.data.length);
        }
      } catch (failure) {
        if (!controller.signal.aborted) {
          setApplications([]);
          setTotal(0);
          setError(failure instanceof Error ? failure.message : "Failed to load applications.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    if (mock) {
      const filtered = status ? fakeApplications.filter((application) => application.status === status) : fakeApplications;
      setApplications(filtered);
      setTotal(filtered.length);
      setPage(1);
      setLoading(false);
      return;
    }

    void loadApplications();
    return () => controller.abort();
  }, [mock, status]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstItem = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastItem = Math.min(page * PAGE_SIZE, total);
  const visibleApplications = applications.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Applications</h1>
        <Button nativeButton={false} render={<Link to="/application" />}>
          New Application
        </Button>
      </header>

      <div className={styles.filter}>
        <label htmlFor="status-filter">Filter by status</label>
        <Select
          value={status || "all"}
          onValueChange={(value) => {
            if (value === null) return;
            const next = new URLSearchParams(searchParams);
            if (value !== "all") {
              next.set("status", value);
            } else {
              next.delete("status");
            }
            setSearchParams(next);
          }}
        >
          <SelectTrigger id="status-filter" className={styles.filterSelect}>
            <SelectValue>
              {status ? applicationStatuses.find((item) => item.value === status)?.label ?? status : "All statuses"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {applicationStatuses.map(({ value, label }) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && <ErrorAlert message={error} />}

      {loading ? (
        <p role="status">Loading applications...</p>
      ) : applications.length === 0 && !error ? (
        <p>No applications found.</p>
      ) : (
        <section
          aria-label="Applications"
          className={styles.applicationList}
        >
          {visibleApplications.map((application) => (
            <Link
              key={application.id}
              to={`/application/${application.id}`}
              className={styles.applicationLink}
            >
              <Card className={styles.applicationCard}>
                <CardHeader>
                  <CardTitle>{application.companyName}</CardTitle>
                  <CardDescription>
                    {application.jobTitle}
                  </CardDescription>
                </CardHeader>
                <CardContent className={styles.cardDetails}>
                  <dl className={styles.details}>
                    <div>
                      <dt>Status</dt>
                      <dd className={styles.status}>{application.status}</dd>
                    </div>
                    <div>
                      <dt>Applied</dt>
                      <dd>
                        {application.appliedDate ? (
                          <time dateTime={application.appliedDate}>
                            {new Date(`${application.appliedDate}T00:00:00Z`).toLocaleDateString(undefined, {
                              year: "numeric",
                              month: "short",
                              day: "numeric",
                              timeZone: "UTC",
                            })}
                          </time>
                        ) : "Not provided"}
                      </dd>
                    </div>
                    <div>
                      <dt>Resume</dt>
                      <dd>{application.resumeName ?? "Not linked"}</dd>
                    </div>
                    <div>
                      <dt>Added</dt>
                      <dd>
                        <time dateTime={application.createdAt}>
                          {new Date(application.createdAt).toLocaleDateString(undefined, {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })}
                        </time>
                      </dd>
                    </div>
                  </dl>
                </CardContent>
              </Card>
            </Link>
          ))}
        </section>
      )}

      <footer className={styles.footer}>
        <p className={styles.count}>
          Showing {firstItem}-{lastItem} of {total}
        </p>
        <div className={styles.pagination}>
          <Button
            type="button"
            variant="outline"
            disabled={loading || page <= 1}
            onClick={() => setPage((current) => current - 1)}
          >
            Previous
          </Button>
          <span className={styles.pageNumber}>
            Page {page} of {totalPages}
          </span>
          <Button
            type="button"
            variant="outline"
            disabled={loading || page >= totalPages}
            onClick={() => setPage((current) => current + 1)}
          >
            Next
          </Button>
        </div>
      </footer>
    </main>
  );
}
