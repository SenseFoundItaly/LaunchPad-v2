/**
 * The North Star store, and the one tool that writes it.
 *
 * ── Why this may write without an approval card ─────────────────────────────
 * The product's headline invariant is that the agent can never silently create
 * evidence: anything that would satisfy a validation substep has to be staged
 * and clicked. That invariant is intact here because **nothing in this file
 * touches evidence**. The pillars live in their own table (migration 042), no
 * gate check reads it, `buildProjectSnapshot` does not select it, and no
 * keyword family or item kind maps to it.
 *
 * It is a draft document. Promoting a pillar into `idea_canvas` goes through
 * the existing, already-authorised canvas route on a founder click — and THAT
 * is the consent moment.
 *
 * `isolation.test.ts` asserts every clause of the paragraph above. If it ever
 * fails, this store has quietly become evidence and the invariant is gone.
 */

import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { query, run } from '@/lib/db';
import { coerceNorthStar, pillarById, PILLAR_IDS, type NorthStar } from './pillars';

export async function readNorthStar(projectId: string): Promise<NorthStar> {
  const rows = await query<{ pillars: unknown }>(
    'SELECT pillars FROM north_star WHERE project_id = ?',
    projectId,
  ).catch(() => [] as { pillars: unknown }[]);
  return coerceNorthStar(rows[0]?.pillars);
}

export async function readPromoted(projectId: string): Promise<Record<string, string>> {
  const rows = await query<{ promoted: unknown }>(
    'SELECT promoted FROM north_star WHERE project_id = ?',
    projectId,
  ).catch(() => [] as { promoted: unknown }[]);
  const raw = rows[0]?.promoted;
  return raw && typeof raw === 'object' ? (raw as Record<string, string>) : {};
}

/**
 * Write one pillar. Upsert + jsonb merge so concurrent writes in the same turn
 * cannot clobber each other — the agent fills several pillars per message, and
 * a whole-object assignment would drop whichever landed first.
 *
 * The JSONB is bound as a RAW object; JSON.stringify double-encodes (CLAUDE.md).
 */
export async function writePillar(projectId: string, id: string, value: string): Promise<boolean> {
  if (!pillarById(id)) return false;
  const text = String(value ?? '').trim().slice(0, 2000);
  if (text.length < 3) return false;
  await run(
    `INSERT INTO north_star (project_id, pillars)
     VALUES (?, ?)
     ON CONFLICT (project_id) DO UPDATE
       SET pillars = north_star.pillars || EXCLUDED.pillars,
           updated_at = CURRENT_TIMESTAMP`,
    projectId,
    { [id]: text },
  );
  return true;
}

/** Stamp the consent moment. Called by the promote route, never by the agent. */
export async function markPromoted(projectId: string, id: string): Promise<void> {
  await run(
    `UPDATE north_star SET promoted = promoted || ?, updated_at = CURRENT_TIMESTAMP
      WHERE project_id = ?`,
    { [id]: new Date().toISOString() },
    projectId,
  );
}

/**
 * The agent's only write tool in the lite kickoff.
 *
 * Deliberately NOT registered in `makeProjectTools` — it is passed explicitly
 * to the lite route's `runAgent` call, so it cannot leak into the main
 * co-pilot, where an ungated write would be exactly the bug the invariant
 * exists to prevent.
 */
export function makeNorthStarTool(projectId: string): AgentTool {
  return {
    name: 'write_north_star',
    label: 'Write North Star',
    description:
      'Write one pillar of the founder\'s North Star. Call it during the kickoff, in the same turn you reply, for every pillar you can fill from what the founder has said — they appear live in the panel beside the chat. Pillars: 01 who we serve, 02 the problem (their words, verbatim), 03 our first move (infer), 04 where it grows (infer), 05 why it lasts. Never invent a pillar the founder gave you no grounds for.',
    parameters: Type.Object({
      pillar: Type.String({ description: 'One of: 01, 02, 03, 04, 05' }),
      value: Type.String({ description: 'The pillar text, founder-facing. For 02 use the founder\'s own sentence verbatim.' }),
    }),
    async execute(_id: string, params: unknown): Promise<AgentToolResult<unknown>> {
      const p = params as Record<string, unknown>;
      const id = String(p.pillar ?? '').trim();
      const value = String(p.value ?? '');
      if (!PILLAR_IDS.includes(id as never)) {
        return {
          content: [{ type: 'text', text: `Unknown pillar "${id}". Use one of: ${PILLAR_IDS.join(', ')}.` }],
          details: { error: 'unknown_pillar' },
        };
      }
      const ok = await writePillar(projectId, id, value);
      return {
        content: [{ type: 'text', text: ok ? `Pillar ${id} written.` : `Pillar ${id} not written — the value was too short.` }],
        details: { pillar: id, written: ok },
      };
    },
  };
}
