import { useEffect, useState } from "react";
import ErrorAlert from "@/components/ErrorAlert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { responseError } from "@/lib/response-error";
import { applicationStatuses } from "@/lib/application-status";
import styles from "@/styles/Applications.module.css";

const PAGE_SIZE = 20;

export default function Applications() {
  const [searchParams, setSearchParams] = useSearchParams();
  const status = searchParams.get("status");
  const [applications, setApplications] = useState<ApplicationSummary[]>([]);
  const [counts, setCounts] = useState<ApplicationList["counts"] | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sort, setSort] = useState<"newest" | "company">("newest");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadApplications() {
      setLoading(true);
      setError(null);
      setPage(1);

      try {
        const query = new URLSearchParams({ sort });
        if (debouncedSearch.trim()) query.set("q", debouncedSearch);
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
          setCounts(result.counts);
        }
      } catch (failure) {
        if (!controller.signal.aborted) {
          setApplications([]);
          setTotal(0);
          setCounts(null);
          setError(failure instanceof Error ? failure.message : "Failed to load applications.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadApplications();
    return () => controller.abort();
  }, [status, debouncedSearch, sort]);

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

      <div className={styles.controls}>
        <div className={styles.filter}>
          <label htmlFor="application-search">Search company or position</label>
          <Input
            id="application-search"
            type="search"
            placeholder="Company or position"
            className={styles.searchInput}
            value={search}
            onChange={(event) => setSearch(Array.from(event.target.value).slice(0, 200).join(""))}
          />
        </div>
        <div className={styles.filter}>
          <label htmlFor="application-sort">Sort by</label>
          <Select value={sort} onValueChange={(value) => {
            if (value === "newest" || value === "company") setSort(value);
          }}>
            <SelectTrigger id="application-sort" className={styles.filterSelect}>
              <SelectValue>{sort === "newest" ? "Newest first" : "Company A–Z"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="company">Company A–Z</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className={styles.statusFilters} role="group" aria-label="Filter by status">
        {([{ value: "all", label: "All" }, ...applicationStatuses] as const).map(({ value, label }) => (
          <Button
            key={value}
            type="button"
            variant={(status || "all") === value ? "default" : "outline"}
            aria-pressed={(status || "all") === value}
            onClick={() => {
              const next = new URLSearchParams(searchParams);
              if (value !== "all") {
                next.set("status", value);
              } else {
                next.delete("status");
              }
              setSearchParams(next);
            }}
          >
            {label} ({counts ? value === "all" ? counts.total : counts.byStatus[value] : "–"})
          </Button>
        ))}
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
