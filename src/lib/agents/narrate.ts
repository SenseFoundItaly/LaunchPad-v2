/**
 * Agent narration (nanocorp P1) — server-side actors write attributed
 * assistant messages into the founder's ONE conversation, generalizing the
 * proven stageLoop1Verdict pattern (src/lib/loops/loop1-psf.ts): owner-scoped,
 * localized, non-throwing, artifact-fence-capable.
 *
 * Every message carries meta = { agent, source_id, server_authored: true,
 * pane? } — `source_id` is the idempotency key (a second call with the same
 * key no-ops, so cron retries never double-narrate), `server_authored` is the
 * live-poll filter (PR-2), `pane` the P3 pane-follow hint.
 *
 * Noise guard: at most AGENT_NARRATION_HOURLY_MAX (default 6) narrations per
 * project per hour — beyond it, prose updates are DROPPED (warn-logged) but
 * priority:'must' messages (decision requests, consented-act confirmations)
 * always post. A silent consented send would be worse than a noisy feed.
 */

import { query, run, get } from '@/lib/db';
import { generateId } from '@/lib/api-helpers';
import { resolveLocale } from '@/lib/i18n/resolve-locale';
import { translate, type MessageKey, type TranslateVars } from '@/lib/i18n/messages';
import type { AgentId } from './registry';

const HOURLY_MAX = Number(process.env.AGENT_NARRATION_HOURLY_MAX || 6);

export interface AgentUpdateContent {
  key: MessageKey;
  params?: TranslateVars;
  /** Optional artifact fence appended below the prose (loop1 fence syntax). */
  artifact?: { type: string; id: string; body: unknown };
}

export interface AgentUpdateOpts {
  /** Idempotency key, e.g. `sent:${messageId}` — stored in meta.source_id. */
  dedupeKey: string;
  /** P3 pane-follow hint. */
  pane?: 'build' | 'growth';
  /** 'must' bypasses the hourly noise cap (decision requests, consented acts). */
  priority?: 'must' | 'info';
  step?: string;
}

/** Post an agent-attributed assistant message. Returns the message id, or
 *  null when skipped (dedupe/noise cap/no owner) or failed. NEVER throws. */
export async function postAgentUpdate(
  projectId: string,
  agent: AgentId,
  content: AgentUpdateContent,
  opts: AgentUpdateOpts,
): Promise<string | null> {
  try {
    const owner = await get<{ owner_user_id: string | null }>(
      'SELECT owner_user_id FROM projects WHERE id = ?', projectId,
    );
    if (!owner?.owner_user_id) return null;

    // Idempotency — cron ticks retry; the narration must not.
    const dup = await get<{ id: string }>(
      `SELECT id FROM chat_messages WHERE project_id = ? AND meta->>'source_id' = ? LIMIT 1`,
      projectId, opts.dedupeKey,
    );
    if (dup) return null;

    // Noise cap (prose only — 'must' always posts).
    if (opts.priority !== 'must') {
      // NOTE: jsonb `?` operator is unusable here — the db helper treats every
      // `?` as a bind placeholder. `->> IS NOT NULL` is the safe equivalent.
      const recent = await query<{ c: number }>(
        `SELECT count(*)::int c FROM chat_messages
          WHERE project_id = ? AND meta->>'agent' IS NOT NULL AND created_at > NOW() - INTERVAL '1 hour'`,
        projectId,
      );
      if ((recent[0]?.c ?? 0) >= HOURLY_MAX) {
        console.warn(`[agents] narration dropped (hourly cap) for ${projectId}: ${opts.dedupeKey}`);
        return null;
      }
    }

    const locale = await resolveLocale(owner.owner_user_id, projectId);
    let body = translate(locale, content.key, content.params);
    if (content.artifact) {
      body += `\n\n:::artifact{"type":"${content.artifact.type}","id":"${content.artifact.id}"}\n${JSON.stringify(content.artifact.body)}\n:::`;
    }

    const id = generateId('msg');
    await run(
      `INSERT INTO chat_messages (id, project_id, step, role, content, "timestamp", user_id, meta)
       VALUES (?, ?, ?, 'assistant', ?, ?, ?, ?)`,
      id, projectId, opts.step ?? 'chat', body, new Date().toISOString(), owner.owner_user_id,
      { agent, source_id: opts.dedupeKey, server_authored: true, ...(opts.pane ? { pane: opts.pane } : {}) },
    );
    return id;
  } catch (err) {
    console.warn('[agents] postAgentUpdate failed (non-fatal):', (err as Error).message);
    return null;
  }
}
