import type { Db } from "../../../db/pool.js";
import { currentMaterials, readMaterialSource, type CurrentMaterial } from "../context/materials.js";

// Database Design §5.6. One workspace per application, created or reused on entry. Entering a
// workspace never creates a conversation, snapshot or generation.

export interface WorkspaceView {
  id: string;
  applicationId: string;
  companyName: string;
  jobTitle: string;
  linkedResume: { id: string; name: string; contentVersion: string } | null;
  /** Current materials keyed by kind, computed on read; no snapshot is saved. */
  materials: Record<string, Omit<CurrentMaterial, "sourceLabel" | "contentText">>;
  createdAt: Date;
}

/** Creates or reuses the owned application's workspace. null when the application is not the user's. */
export async function ensureWorkspace(db: Db, userId: string, applicationId: string): Promise<WorkspaceView | null> {
  await db.query(`
    INSERT INTO public.ai_workspaces (application_id)
    SELECT a.id FROM public.applications a WHERE a.id = $1 AND a.user_id = $2
    ON CONFLICT (application_id) DO NOTHING
  `, [applicationId, userId]);
  const { rows: [row] } = await db.query<{ id: string }>(`
    SELECT w.id FROM public.ai_workspaces w
    JOIN public.applications a ON a.id = w.application_id
    WHERE w.application_id = $1 AND a.user_id = $2
  `, [applicationId, userId]);
  return row ? getWorkspace(db, userId, row.id) : null;
}

export async function getWorkspace(db: Db, userId: string, workspaceId: string): Promise<WorkspaceView | null> {
  const { rows: [workspace] } = await db.query<{ id: string; applicationId: string; createdAt: Date }>(`
    SELECT w.id, w.application_id AS "applicationId", w.created_at AS "createdAt"
    FROM public.ai_workspaces w
    JOIN public.applications a ON a.id = w.application_id
    WHERE w.id = $1 AND a.user_id = $2
  `, [workspaceId, userId]);
  if (!workspace) return null;
  const source = await readMaterialSource(db, workspace.applicationId);
  if (!source) return null; // deleted between the two reads

  const materials: WorkspaceView["materials"] = {};
  for (const { sourceLabel: _label, contentText: _text, ...metadata } of currentMaterials(source)) {
    materials[metadata.kind] = metadata;
  }
  const { resume } = source;
  return {
    ...workspace,
    companyName: source.companyName,
    jobTitle: source.positionTitle,
    linkedResume: resume && { id: resume.id, name: resume.name, contentVersion: resume.contentVersion },
    materials,
  };
}
