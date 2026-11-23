import { useRef, useState } from "react";
import { Link } from "react-router";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AiConversation } from "@/types";
import styles from "@/styles/ConversationList.module.css";

type ConversationListProps = {
  workspaceId: string;
  /** Most recently updated first, as the API returns them. */
  conversations: AiConversation[];
  selectedId: string | null;
  creating: boolean;
  onNew: () => void;
  onRename: (conversationId: string, title: string) => void;
};

// Conversations are independent: each has its own history, and all share the workspace's materials.
// The backend titles a conversation with the first sentence of its first message; users can rename it.
export default function ConversationList({ workspaceId, conversations, selectedId, creating, onNew, onRename }: ConversationListProps) {
  const [editing, setEditing] = useState<AiConversation | null>(null);
  const [draft, setDraft] = useState("");
  const cancelled = useRef(false);

  function startEditing(conversation: AiConversation) {
    cancelled.current = false;
    setDraft(conversation.title ?? "");
    setEditing(conversation);
  }

  // Enter and leaving the field save; Escape cancels. A blank or unchanged title saves nothing.
  function finishEditing() {
    const title = draft.trim();
    if (editing && !cancelled.current && title && title !== editing.title) onRename(editing.id, title);
    setEditing(null);
  }

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
            const title = conversation.title ?? "New conversation";
            if (editing?.id === conversation.id) {
              return (
                <li key={conversation.id}>
                  <Input
                    autoFocus
                    aria-label="Conversation title"
                    maxLength={80}
                    value={draft}
                    className={styles.titleInput}
                    onFocus={(event) => event.currentTarget.select()}
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={finishEditing}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") cancelled.current = true;
                      if (event.key === "Escape" || (event.key === "Enter" && !event.nativeEvent.isComposing)) {
                        event.currentTarget.blur();
                      }
                    }}
                  />
                </li>
              );
            }
            return (
              <li key={conversation.id} className={selected ? `${styles.row} ${styles.selected}` : styles.row}>
                <Link
                  to={`/interview/${workspaceId}/${conversation.id}`}
                  aria-current={selected ? "page" : undefined}
                  className={styles.item}
                >
                  <span className={styles.itemTitle}>{title}</span>
                  <time className={styles.itemTime} dateTime={conversation.updatedAt}>
                    {new Date(conversation.updatedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                  </time>
                </Link>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className={styles.editButton}
                  aria-label={`Rename "${title}"`}
                  title="Rename"
                  onClick={() => startEditing(conversation)}
                >
                  <Pencil aria-hidden="true" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
