import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Search } from "lucide-react";
import ErrorAlert from "@/components/ErrorAlert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listAiApplications, openWorkspace } from "@/lib/ai";
import { applicationStatuses } from "@/lib/application-status";
import type { AiApplicationOption, AiApplicationStatus } from "@/types";
import styles from "@/styles/Interview.module.css";

const statusLabels: Record<string, string> = Object.fromEntries(applicationStatuses.map(({ value, label }) => [value, label]));

// Standalone AI entry: pick a position, then open its workspace (/interview/:workspaceId).
// `?application=<id>` comes from an application's detail page and skips the picker.
export default function Interview() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const entryApplicationId = searchParams.get("application");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<AiApplicationStatus | "all">("all");
  const [applications, setApplications] = useState<AiApplicationOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(entryApplicationId);

  useEffect(() => {
    const controller = new AbortController();
    // Wait for typing to pause before searching.
    const timer = window.setTimeout(async () => {
      try {
        const list = await listAiApplications({ q: query.trim(), status: status === "all" ? undefined : status }, controller.signal);
        setApplications(list.data);
        setError(null);
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Failed to load applications.");
      }
    }, query ? 250 : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, status]);

  useEffect(() => {
    if (!entryApplicationId) return;
    let active = true;
    openWorkspace(entryApplicationId).then(
      (workspace) => { if (active) navigate(`/interview/${workspace.id}`, { replace: true }); },
      (failure: unknown) => {
        if (!active) return;
        setError(failure instanceof Error ? failure.message : "Failed to open the AI workspace.");
        setOpeningId(null);
      },
    );
    return () => { active = false; };
  }, [entryApplicationId, navigate]);

  async function open(applicationId: string) {
    setOpeningId(applicationId);
    setError(null);
    try {
      const workspace = await openWorkspace(applicationId);
      navigate(`/interview/${workspace.id}`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Failed to open the AI workspace.");
      setOpeningId(null);
    }
  }

  if (entryApplicationId && openingId === entryApplicationId) {
    return <main className={styles.page}><p role="status">Opening the AI workspace...</p></main>;
  }

  const filtered = query.trim() !== "" || status !== "all";

  return (
    <main className={styles.page}>
      <header>
        <h1 className={styles.title}>AI Interview Prep</h1>
        <p className={styles.hint}>
          Choose an application to get resume advice, predict interview questions or run a mock interview.
          The AI uses the resume, job description and company details saved with that application.
        </p>
      </header>

      <div className={styles.filters}>
        <div className={styles.search}>
          <label htmlFor="ai-search">Search</label>
          <div className={styles.searchField}>
            <Search aria-hidden="true" className={styles.searchIcon} />
            <Input
              id="ai-search"
              type="search"
              placeholder="Company or position"
              value={query}
              className={styles.searchInput}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>
        <div className={styles.status}>
          <label htmlFor="ai-status">Status</label>
          <Select value={status} onValueChange={(value) => value && setStatus(value as AiApplicationStatus | "all")}>
            <SelectTrigger id="ai-status" className={styles.statusSelect}>
              <SelectValue>{status === "all" ? "All statuses" : statusLabels[status]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {applicationStatuses.map(({ value, label }) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {error && <ErrorAlert message={error} />}

      {applications === null ? (
        !error && <p role="status">Loading applications...</p>
      ) : applications.length === 0 ? (
        <div className={styles.empty}>
          {filtered ? (
            <p>No applications match your search. Try another keyword or status.</p>
          ) : (
            <>
              <p>You have no applications yet. Add one to start preparing with AI.</p>
              <Button nativeButton={false} render={<Link to="/application" />}>New Application</Button>
            </>
          )}
        </div>
      ) : (
        <section aria-label="Applications" className={styles.grid}>
          {applications.map((application) => (
            <button
              key={application.id}
              type="button"
              className={styles.option}
              disabled={openingId !== null}
              onClick={() => void open(application.id)}
            >
              <span className={styles.optionTitle}>{application.jobTitle}</span>
              <span className={styles.optionCompany}>{application.companyName}</span>
              <span className={styles.optionFooter}>
                <span className={styles.badge}>{statusLabels[application.status] ?? application.status}</span>
                <span className={styles.openLabel}>{openingId === application.id ? "Opening..." : "Open workspace →"}</span>
              </span>
            </button>
          ))}
        </section>
      )}
    </main>
  );
}
