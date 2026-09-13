import { createHash } from 'node:crypto';
import { query, run } from './db';
import { getPendingAction } from './pending-actions';
import { parseMessageContent } from './artifact-parser';
import type { PendingAction } from '@/types';

const MAX_ITEMS = 20;

export interface OrphanRecoveryInput {
  projectId: string;
  requestedId: string;
  artifactId?: unknown;
  transition: string;
  editedPayload?: unknown;
}

interface ValidationItem {
  id?: unknown;
  value?: unknown;
  [key: string]: unknown;
}

export function extractValidationItems(editedPayload: unknown): ValidationItem[] | null {
  if (!editedPayload || typeof editedPayload !== 'object') return null;
  const items = (editedPayload as { items?: unknown }).items;
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS) return null;
  const usable = items.filter(
    (it): it is ValidationItem =>
      !!it && typeof it === 'object'
      && typeof it.value === 'string' && it.value.trim().length > 0,
  );
  return usable.length === items.length ? usable : null;
}

/** Only editable text and removal come from the browser; provenance and item
 * kinds come from the artifact the server actually stored. */
export function recoveredValidationEdits(original: unknown, edited: unknown): Record<string, unknown> | null {
  const source = extractValidationItems(original);
  const wanted = extractValidationItems(edited);
  if (!source || !wanted) return null;
  const byId = new Map(source.map((it) => [it.id, it]));
  if (byId.size !== source.length || source.some((it) => typeof it.id !== 'string' || !it.id)) return null;
  const seen = new Set();
  const items: ValidationItem[] = [];
  for (const it of wanted) {
    const saved = byId.get(it.id);
    if (!saved || seen.has(it.id) || it.kind !== saved.kind || it.field !== saved.field) return null;
    seen.add(it.id);
    items.push({ ...saved, value: it.value, ...(typeof it.name === 'string' ? { name: it.name } : {}) });
  }
  return { items };
}

/** Locate a real persisted card, never trust a placeholder ID or edited text
 * as identity. Ambiguous reused artifact IDs are refused rather than applying
 * a different card. Both lookup and recovery use this same source identity. */
async function storedValidation(input: Pick<OrphanRecoveryInput, 'projectId' | 'requestedId' | 'artifactId'>) {
  if (typeof input.artifactId !== 'string' || !input.artifactId || input.artifactId.length > 250) return null;
  const rows = await query<{ id: string; content: string }>(
    `SELECT id, content FROM chat_messages
     WHERE project_id = ? AND role = 'assistant'
       AND content LIKE '%validation-proposal%' AND strpos(content, ?) > 0`,
    input.projectId, input.artifactId,
  );
  const matches: Array<{ messageId: string; index: number; artifact: Record<string, unknown> }> = [];
  for (const row of rows) {
    parseMessageContent(row.content).forEach((segment, index) => {
      if (segment.type !== 'artifact' || segment.artifact.type !== 'validation-proposal') return;
      const artifact = segment.artifact;
      if (artifact.id === input.artifactId && artifact.pending_action_id === input.requestedId) {
        matches.push({ messageId: row.id, index, artifact: artifact as unknown as Record<string, unknown> });
      }
    });
  }
  if (matches.length !== 1) return null;
  const match = matches[0];
  const digest = createHash('sha256').update(JSON.stringify([input.projectId, match.messageId, match.index, input.artifactId])).digest('hex');
  return { ...match, id: `pa_recovered_${digest.slice(0, 32)}` };
}

/** Read-only reload guard: GET must never stage an action. */
export async function findRecoveredValidation(input: Pick<OrphanRecoveryInput, 'projectId' | 'requestedId' | 'artifactId'>): Promise<PendingAction | null> {
  const source = await storedValidation(input);
  return source ? getPendingAction(source.id) : null;
}

export async function recoverOrphanValidation(input: OrphanRecoveryInput): Promise<PendingAction | null> {
  if (input.transition !== 'apply' && input.transition !== 'reject') return null;
  const source = await storedValidation(input);
  if (!source) return null;
  // Reject needs only an authentic card; even malformed evidence must have an
  // exit. Apply must match a valid subset of its original items.
  if (input.transition === 'apply' && !recoveredValidationEdits(source.artifact, input.editedPayload)) return null;
  const now = new Date().toISOString();
  // The primary key is the concurrency guard: simultaneous clicks resolve to
  // one row, and the ordinary atomic pending-action transition claims it once.
  await run(
    `INSERT INTO pending_actions
       (id, project_id, action_type, title, rationale, payload, estimated_impact, status, created_at, updated_at)
     VALUES (?, ?, 'validation_proposal', ?, ?, ?, 'medium', 'pending', ?, ?)
     ON CONFLICT (id) DO NOTHING`,
    source.id, input.projectId, 'Validation evidence (recovered)',
    'Recovered from the original chat card; founder review is required.',
    { origin: 'recovered', items: source.artifact.items, recovery: { message_id: source.messageId, artifact_id: input.artifactId, requested_id: input.requestedId } },
    now, now,
  );
  return getPendingAction(source.id);
}
