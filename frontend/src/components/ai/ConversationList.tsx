import { Link } from "react-router";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AiConversation } from "@/types";
import styles from "@/styles/ConversationList.module.css";

type ConversationListProps = {
  workspaceId: string;
  /** Most recently updated first, as the API returns them. */
  conversations: AiConversation[];
  selectedId: string | null;
  creating: boolean;
  onNew: () => void;
};

// Conversations are independent: each has its own history, and all share the workspace's materials.
// The backend titles a conversation with the first sentence of its first message.
export default function ConversationList({ workspaceId, conversations, selectedId, creating, onNew }: ConversationListProps) {
  return (
    <nav className={styles.list} aria-label="Conversations">
      <Button type="button" variant="outline" className={styles.newButton} disabled={creating} onClick={onNew}>
        <Plus aria-hidden="true" />
        {creating ? "Creating..." : "New conversation"}
      </Button>
      {conversations.length === 0 ? (
        <p className={styles.empty}>No conversations yet.</p>
      ) : (
        <ul className={styles.items}>
          {conversations.map((conversation) => {
            const selected = conversation.id === selectedId;
            return (
              <li key={conversation.id}>
                <Link
                  to={`/interview/${workspaceId}/${conversation.id}`}
                  aria-current={selected ? "page" : undefined}
                  className={selected ? `${styles.item} ${styles.selected}` : styles.item}
                >
                  <span className={styles.itemTitle}>{conversation.title ?? "New conversation"}</span>
                  <time className={styles.itemTime} dateTime={conversation.updatedAt}>
                    {new Date(conversation.updatedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                  </time>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
