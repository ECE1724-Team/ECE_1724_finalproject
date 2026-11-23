import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowLeft, CircleCheck, CircleX, TriangleAlert } from "lucide-react";
import ChatPanel from "@/components/ai/ChatPanel";
import ConversationList from "@/components/ai/ConversationList";
import ErrorAlert from "@/components/ErrorAlert";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  createConversation, getWorkspace, listConversations, materialLabel, renameConversation, sortByKind, unavailableReason,
} from "@/lib/ai";
import type { AiConversation, AiWorkspace } from "@/types";
import styles from "@/styles/InterviewWorkspace.module.css";

// Company and position are in the page title, so only the other materials get a chip.
const TITLE_KINDS = new Set(["company", "position"]);

async function readWorkspace(workspaceId: string, signal?: AbortSignal) {
  const [workspace, list] = await Promise.all([getWorkspace(workspaceId, signal), listConversations(workspaceId, signal)]);
  return { workspace, conversations: list.data };
}

// One application's workspace. The selected conversation lives in the URL
// (/interview/:workspaceId/:conversationId), so a reload restores it.
export default function InterviewWorkspace() {
  const { workspaceId = "", conversationId } = useParams();
  const navigate = useNavigate();
  const [workspace, setWorkspace] = useState<AiWorkspace | null>(null);
  const [conversations, setConversations] = useState<AiConversation[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    readWorkspace(workspaceId, controller.signal).then(
      (next) => {
        setWorkspace(next.workspace);
        setConversations(next.conversations);
      },
      (failure: unknown) => {
        if (!controller.signal.aborted) setLoadError(failure instanceof Error ? failure.message : "Failed to load the workspace.");
      },
    );
    return () => controller.abort();
  }, [workspaceId]);

  // Re-entering a workspace continues its most recent conversation.
  useEffect(() => {
    if (!conversationId && conversations?.length) {
      navigate(`/interview/${workspaceId}/${conversations[0].id}`, { replace: true });
    }
  }, [conversationId, conversations, navigate, workspaceId]);

  // After a turn the title, order and current materials may have changed. The chat reports its own
  // errors, so a failed background refresh just keeps the previous header and list.
  const handleActivity = useCallback(() => {
    readWorkspace(workspaceId).then((next) => {
      setWorkspace(next.workspace);
      setConversations(next.conversations);
    }, () => undefined);
  }, [workspaceId]);

  async function newConversation() {
    setCreating(true);
    setActionError(null);
    try {
      const conversation = await createConversation(workspaceId);
      setConversations((current) => [conversation, ...(current ?? [])]);
      navigate(`/interview/${workspaceId}/${conversation.id}`);
    } catch (failure) {
      setActionError(failure instanceof Error ? failure.message : "Failed to create a conversation.");
    } finally {
      setCreating(false);
    }
  }

  async function rename(conversationId: string, title: string) {
    setActionError(null);
    try {
      const renamed = await renameConversation(conversationId, title);
      setConversations((current) => current?.map((conversation) => conversation.id === renamed.id ? renamed : conversation) ?? null);
    } catch (failure) {
      setActionError(failure instanceof Error ? failure.message : "Failed to rename the conversation.");
    }
  }

  if (loadError) {
    return (
      <main className={styles.page}>
        <ErrorAlert message={loadError} />
        <Button variant="outline" nativeButton={false} render={<Link to="/interview" />} className={styles.backButton}>
          Back to positions
        </Button>
      </main>
    );
  }

  if (!workspace || !conversations) {
    return <main className={styles.page}><p role="status">Loading workspace...</p></main>;
  }

  const resume = workspace.materials.resume;
  const chips = sortByKind(Object.values(workspace.materials)).filter((material) => !TITLE_KINDS.has(material.kind));

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link to="/interview" className={styles.back}>
          <ArrowLeft aria-hidden="true" /> All positions
        </Link>
        <div className={styles.row}>
          <h1 className={styles.title}>{workspace.jobTitle}</h1>
          <Button variant="outline" nativeButton={false} render={<Link to={`/application/${workspace.applicationId}`} />}>
            Edit application
          </Button>
        </div>
        <div className={styles.row}>
          <p className={styles.company}>{workspace.companyName}</p>
          <ul className={styles.chips} aria-label="Materials the AI uses">
            {chips.map((material) => {
              const available = material.availability === "available";
              return (
                <li
                  key={material.kind}
                  className={available ? styles.chip : `${styles.chip} ${styles.chipMissing}`}
                  title={available ? undefined : unavailableReason(material.reasonCode)}
                >
                  {available
                    ? <CircleCheck aria-hidden="true" className={styles.chipIconOk} />
                    : <CircleX aria-label="Missing" />}
                  {materialLabel(material.kind)}
                  {material.kind === "resume" && workspace.linkedResume && `: ${workspace.linkedResume.name}`}
                </li>
              );
            })}
          </ul>
        </div>
      </header>

      {resume?.reasonCode === "RESUME_TEXT_UNAVAILABLE" && (
        <Alert className={styles.warning}>
          <TriangleAlert aria-hidden="true" />
          <AlertDescription className={styles.warningText}>
            The AI cannot read the linked resume{workspace.linkedResume && ` "${workspace.linkedResume.name}"`}: no text
            could be extracted from the PDF (for example, a scanned image). Replies will use the other materials only.
          </AlertDescription>
        </Alert>
      )}

      {actionError && <ErrorAlert message={actionError} />}

      <div className={styles.layout}>
        <ConversationList
          workspaceId={workspaceId}
          conversations={conversations}
          selectedId={conversationId ?? null}
          creating={creating}
          onNew={() => void newConversation()}
          onRename={(conversationId, title) => void rename(conversationId, title)}
        />
        <ChatPanel
          key={conversationId ?? "none"}
          conversationId={conversationId ?? null}
          workspace={workspace}
          creating={creating}
          onNew={() => void newConversation()}
          onActivity={handleActivity}
        />
      </div>
    </main>
  );
}
