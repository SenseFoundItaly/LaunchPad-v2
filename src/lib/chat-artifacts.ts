/**
 * Chat artifact retrievability (gap C) — persist the analysis/deliverable cards
 * the agent renders inline in chat as first-class rows, so they survive the chat
 * scroll and surface in the Data Room. The card DATA already lands in domain
 * stores via persistArtifact (competitors→graph, market→research, …); this keeps
 * the RENDERED card retrievable as an object (type + payload + sources), which
 * those domain writes don't.
 */
import { query, run } from '@/lib/db';
import { generateId } from '@/lib/api-helpers';
import type { Artifact, Source } from '@/types/artifacts';
import { isRetrievableArtifact, deriveTitle } from '@/lib/chat-artifact-meta';

// Re-export for existing consumers/tests — the definitions live in the pure
// meta module so the client Data Room panel can share them without pulling db.
export { isRetrievableArtifact } from '@/lib/chat-artifact-meta';

export interface CaptureCtx {
  projectId: string;
  chatMessageId?: string | null;
  turnPreview?: string;
}

/**
 * Persist one chat artifact as a retrievable row. No-op (returns null) for
 * non-retrievable types. Non-throwing — a capture failure must never break the
 * chat turn. sources/payload are JSONB: bind RAW (never JSON.stringify — that
 * double-encodes; see finding-jsonb-double-encode-audit).
 */
export async function captureChatArtifact(ctx: CaptureCtx, artifact: Artifact): Promise<string | null> {
  if (!isRetrievableArtifact(artifact.type)) return null;
  try {
    const id = generateId('cart');
    const sources = (artifact as unknown as { sources?: Source[] }).sources;
    await run(
      `INSERT INTO chat_artifacts (id, project_id, chat_message_id, artifact_type, title, payload, sources, turn_preview)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      ctx.projectId,
      ctx.chatMessageId ?? null,
      artifact.type,
      deriveTitle(artifact),
      artifact,
      Array.isArray(sources) ? sources : [],
      ctx.turnPreview ? ctx.turnPreview.slice(0, 200) : null,
    );
    return id;
  } catch (err) {
    console.warn('[chat-artifacts] capture failed (non-fatal):', (err as Error).message);
    return null;
  }
}

export interface ChatArtifactRow {
  id: string;
  artifact_type: string;
  title: string | null;
  payload: unknown;
  sources: unknown;
  created_at: string;
}

/** List a project's retrievable chat artifacts, newest first (for the Data Room). */
export async function listChatArtifacts(projectId: string, limit = 200): Promise<ChatArtifactRow[]> {
  try {
    return await query<ChatArtifactRow>(
      `SELECT id, artifact_type, title, payload, sources, created_at
         FROM chat_artifacts WHERE project_id = ?
        ORDER BY created_at DESC LIMIT ?`,
      projectId,
      limit,
    );
  } catch (err) {
    console.warn('[chat-artifacts] list failed (non-fatal):', (err as Error).message);
    return [];
  }
}
