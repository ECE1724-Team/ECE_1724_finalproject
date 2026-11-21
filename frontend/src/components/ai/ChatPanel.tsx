import styles from "@/styles/ChatPanel.module.css";

type ChatPanelProps = {
  conversationId: string | null;
};

// TODO(Phase 5): messages (listMessages), input with editable shortcuts, sending through
// streamGeneration (disabled while a generation is active), material sync status, retry after a
// failure or disconnect (getGeneration restores a saved reply), and expanding an old reply to see
// the materials it used (getMaterialSnapshot).
export default function ChatPanel({ conversationId }: ChatPanelProps) {
  return (
    <section className={styles.panel} aria-label="Chat">
      <p className={styles.empty}>
        {conversationId ? "Loading conversation…" : "Select a conversation or start a new one."}
      </p>
    </section>
  );
}
