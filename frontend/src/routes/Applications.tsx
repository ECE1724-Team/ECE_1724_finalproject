import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Link } from "react-router";
import type { ApplicationList, ApplicationSummary } from "../types";
import { fakeApplications } from "../lib/testpayloads";
import styles from "@/styles/Applications.module.css";

const PAGE_SIZE = 20;

export default function Applications({ mock = false }) {
  const [applications, setApplications] = useState<ApplicationSummary[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {

    async function loadApplications() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          "/api/v1/applications?sort=newest",
          {
            credentials: "include",
          },
        );

        if (!response.ok) {
          throw new Error();
        }

        const result = await response.json() as ApplicationList;
        setApplications(result.data);
        setTotal(result.counts.total);
      } catch {
        setError("Failed to load applications");
      } finally {
        setLoading(false);
      }
    }

    if (mock) {
      setApplications(fakeApplications);
      setTotal(fakeApplications.length);
      setLoading(false);
      return;
    }

    loadApplications();
  }, [mock]);

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

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <p role="status">Loading applications...</p>
      ) : applications.length === 0 && !error ? (
        <p>No applications found.</p>
      ) : (
        <section
          aria-label="Applications"
          className={styles.applicationGrid}
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
                <CardContent>
                  <p className={styles.status}>{application.status}</p>
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
