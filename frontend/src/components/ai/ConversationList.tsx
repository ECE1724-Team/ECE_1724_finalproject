import styles from "@/styles/ConversationList.module.css";

type ConversationListProps = {
  workspaceId: string;
  selectedId: string | null;
};

// TODO(Phase 5): list conversations (listConversations), "New conversation" (createConversation),
// titles from the first message, and navigation to /interview/:workspaceId/:conversationId.
export default function ConversationList(_props: ConversationListProps) {
  return (
    <nav className={styles.list} aria-label="Conversations">
      <p className={styles.empty}>No conversations yet.</p>
    </nav>
  );
}
