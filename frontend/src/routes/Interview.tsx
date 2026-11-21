import styles from "@/styles/Interview.module.css";

// Standalone AI entry: pick a position, then open its workspace (/interview/:workspaceId).
// TODO(Phase 5): position search and status filter (listAiApplications), empty states with a link
// to Applications, and openWorkspace on selection.
export default function Interview() {
  return (
    <main className={styles.page}>
      <h1 className={styles.title}>AI Interview</h1>
      <p className={styles.hint}>Choose an application to get resume advice or practice an interview.</p>
    </main>
  );
}
