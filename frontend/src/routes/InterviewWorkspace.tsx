import { useParams } from "react-router";
import ChatPanel from "@/components/ai/ChatPanel";
import ConversationList from "@/components/ai/ConversationList";
import styles from "@/styles/InterviewWorkspace.module.css";

// One application's workspace. The selected conversation lives in the URL
// (/interview/:workspaceId/:conversationId), so a reload restores it.
// TODO(Phase 5): load the workspace (getWorkspace) and show the company, position, linked resume and
// whether its text is available.
export default function InterviewWorkspace() {
  const { workspaceId, conversationId } = useParams();

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>AI workspace</h1>
      </header>
      <div className={styles.layout}>
        <ConversationList workspaceId={workspaceId!} selectedId={conversationId ?? null} />
        <ChatPanel conversationId={conversationId ?? null} />
      </div>
    </main>
  );
}
