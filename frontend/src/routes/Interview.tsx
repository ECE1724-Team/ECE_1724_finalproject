import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Plus, Search } from "lucide-react";
import ErrorAlert from "@/components/ErrorAlert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listAiApplications, openWorkspace } from "@/lib/ai";
import { applicationStatuses } from "@/lib/application-status";
import type { AiApplicationOption, AiApplicationStatus } from "@/types";
import styles from "@/styles/Interview.module.css";

const statusLabels: Record<string, string> = Object.fromEntries(applicationStatuses.map(({ value, label }) => [value, label]));

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

// AI Copilot home: the user's workspaces (one per application), and "New workspace", which picks
// an application without one. `?application=<id>` comes from an application's detail page and
// opens (or creates) that application's workspace directly.
export default function Interview() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const entryApplicationId = searchParams.get("application");
  const [workspaces, setWorkspaces] = useState<AiApplicationOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(entryApplicationId);
  // The "New workspace" picker and its filters.
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<AiApplicationStatus | "all">("all");
  const [candidates, setCandidates] = useState<AiApplicationOption[] | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    listAiApplications({}, controller.signal).then(
      (list) => setWorkspaces(list.data.filter((application) => application.workspaceId)),
      (failure: unknown) => { if (!controller.signal.aborted) setError(errorMessage(failure, "Failed to load workspaces.")); },
    );
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!picking) return;
    const controller = new AbortController();
    // Wait for typing to pause before searching.
    const timer = window.setTimeout(async () => {
      try {
        const list = await listAiApplications({ q: query.trim(), status: status === "all" ? undefined : status }, controller.signal);
        setCandidates(list.data.filter((application) => !application.workspaceId));
      } catch (failure) {
        if (!controller.signal.aborted) setError(errorMessage(failure, "Failed to load applications."));
      }
    }, query ? 250 : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [picking, query, status]);

  useEffect(() => {
    if (!entryApplicationId) return;
    let active = true;
    openWorkspace(entryApplicationId).then(
      (workspace) => { if (active) navigate(`/interview/${workspace.id}`, { replace: true }); },
      (failure: unknown) => {
        if (!active) return;
        setError(errorMessage(failure, "Failed to open the AI workspace."));
        setOpeningId(null);
      },
    );
    return () => { active = false; };
  }, [entryApplicationId, navigate]);

  async function create(applicationId: string) {
    setOpeningId(applicationId);
    setError(null);
    try {
      const workspace = await openWorkspace(applicationId);
      navigate(`/interview/${workspace.id}`);
    } catch (failure) {
      setError(errorMessage(failure, "Failed to create the workspace."));
      setOpeningId(null);
    }
  }

  if (entryApplicationId && openingId === entryApplicationId) {
    return <main className={styles.page}><p role="status">Opening the AI workspace...</p></main>;
  }

  const filtered = query.trim() !== "" || status !== "all";

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>AI Copilot</h1>
          <p className={styles.hint}>
            Each workspace belongs to one application and uses its resume, job description and company details.
            Open one to get resume advice, predict interview questions or run a mock interview.
          </p>
        </div>
        {!picking && (
          <Button type="button" onClick={() => setPicking(true)}>
            <Plus aria-hidden="true" />
            New workspace
          </Button>
        )}
      </header>

      {error && <ErrorAlert message={error} />}

      {picking && (
        <Card>
          <CardHeader>
            <CardTitle>New workspace</CardTitle>
            <CardDescription>Choose the application to prepare for.</CardDescription>
          </CardHeader>
          <CardContent className={styles.picker}>
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

            {candidates === null ? (
              <p role="status" className={styles.empty}>Loading applications...</p>
            ) : candidates.length > 0 ? (
              <ul className={styles.candidates}>
                {candidates.map((application) => (
                  <li key={application.id}>
                    <button
                      type="button"
                      className={styles.candidate}
                      disabled={openingId !== null}
                      onClick={() => void create(application.id)}
                    >
                      <span className={styles.candidateText}>
                        <span className={styles.optionTitle}>{application.jobTitle}</span>
                        <span className={styles.optionCompany}>{application.companyName}</span>
                      </span>
                      <span className={styles.badge}>
                        {openingId === application.id ? "Creating..." : statusLabels[application.status] ?? application.status}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : filtered ? (
              <p className={styles.empty}>No applications without a workspace match your search.</p>
            ) : workspaces?.length ? (
              <p className={styles.empty}>Every application already has a workspace.</p>
            ) : (
              <div className={styles.empty}>
                <p>You have no applications yet. Add one to start preparing with AI.</p>
                <Button nativeButton={false} render={<Link to="/application" />}>New Application</Button>
              </div>
            )}

            <Button type="button" variant="outline" className={styles.cancel} onClick={() => setPicking(false)}>
              Cancel
            </Button>
          </CardContent>
        </Card>
      )}

      {workspaces === null ? (
        !error && <p role="status">Loading workspaces...</p>
      ) : workspaces.length === 0 ? (
        !picking && <p className={styles.empty}>No workspaces yet. Create one from an application to start.</p>
      ) : (
        <section aria-label="Workspaces" className={styles.grid}>
          {workspaces.map((application) => (
            <Link key={application.id} to={`/interview/${application.workspaceId}`} className={styles.option}>
              <span className={styles.optionTitle}>{application.jobTitle}</span>
              <span className={styles.optionCompany}>{application.companyName}</span>
              <span className={styles.optionFooter}>
                <span className={styles.badge}>{statusLabels[application.status] ?? application.status}</span>
                <span className={styles.openLabel}>Open workspace →</span>
              </span>
            </Link>
          ))}
        </section>
      )}
    </main>
  );
}
