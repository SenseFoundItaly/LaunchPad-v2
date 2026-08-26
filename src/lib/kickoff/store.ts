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
import {
  coerceSections, sectionById, SECTION_IDS, CONFIDENCE_ORDER,
  type Sections, type Confidence,
} from './sections';

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

export async function readSections(projectId: string): Promise<Sections> {
  const rows = await query<{ sections: unknown }>(
    'SELECT sections FROM north_star WHERE project_id = ?',
    projectId,
  ).catch(() => [] as { sections: unknown }[]);
  return coerceSections(rows[0]?.sections);
}

/**
 * Write one section. Same upsert + jsonb merge as `writePillar`, and for the
 * same reason: the audit fills seven sections in a single turn, and a
 * whole-object assignment would drop every write but the last.
 */
export async function writeSection(
  projectId: string,
  id: string,
  text: string,
  risk: string,
  confidence: Confidence,
): Promise<boolean> {
  if (!sectionById(id)) return false;
  const body = String(text ?? '').trim().slice(0, 4000);
  if (body.length < 3) return false;
  const section = {
    text: body,
    risk: String(risk ?? '').trim().slice(0, 600),
    confidence,
    updatedAt: new Date().toISOString(),
  };
  await run(
    `INSERT INTO north_star (project_id, sections)
     VALUES (?, ?)
     ON CONFLICT (project_id) DO UPDATE
       SET sections = north_star.sections || EXCLUDED.sections,
           updated_at = CURRENT_TIMESTAMP`,
    projectId,
    { [id]: section },
  );
  return true;
}

/**
 * The audit's write tool.
 *
 * `risk` and `confidence` are REQUIRED parameters, not optional extras. That is
 * the whole design: an agent filling seven sections from two founder sentences
 * is guessing at some of them, and a tool that let it stay silent about which
 * ones would produce a plan that reads as authoritative and is not. Making the
 * model name the weakness in the same call that writes the content is what buys
 * the right to fill a section nobody asked about.
 */
export function makeSectionTool(projectId: string): AgentTool {
  return {
    name: 'write_section',
    label: 'Write section',
    description:
      'Write one section of the founder\'s plan. Sections: founder_fit, customer, problem, service_system, business_model, gtm, relationship_capital. Call it once per section — fill ALL of them, even the ones the founder never mentioned, because an honest draft beats an empty box. You MUST state the risk and the confidence for each: "grounded" only if the founder actually said it, "inferred" if you reasoned it from what they said, "assumed" if you filled it to keep the plan whole. Never mark a guess as grounded.',
    parameters: Type.Object({
      section: Type.String({ description: `One of: ${SECTION_IDS.join(', ')}` }),
      text: Type.String({ description: 'The section, founder-facing. 2-5 sentences. Concrete, no filler.' }),
      risk: Type.String({ description: 'The single thing that would make this section WRONG. One sentence, specific and testable.' }),
      confidence: Type.String({ description: 'grounded | inferred | assumed' }),
    }),
    async execute(_id: string, params: unknown): Promise<AgentToolResult<unknown>> {
      const p = params as Record<string, unknown>;
      const id = String(p.section ?? '').trim();
      if (!SECTION_IDS.includes(id)) {
        return {
          content: [{ type: 'text', text: `Unknown section "${id}". Use one of: ${SECTION_IDS.join(', ')}.` }],
          details: { error: 'unknown_section' },
        };
      }
      const raw = String(p.confidence ?? '').trim().toLowerCase();
      // Unrecognised confidence degrades to 'assumed' — never upward. A typo
      // must not be able to launder a guess into a fact.
      const confidence = (CONFIDENCE_ORDER as readonly string[]).includes(raw)
        ? (raw as Confidence)
        : 'assumed';
      const ok = await writeSection(projectId, id, String(p.text ?? ''), String(p.risk ?? ''), confidence);
      return {
        content: [{
          type: 'text',
          text: ok
            ? `Section ${id} written (${confidence}).`
            : `Section ${id} not written — the text was too short.`,
        }],
        details: { section: id, written: ok, confidence },
      };
    },
  };
}

/**
 * The founder rewrites a section by hand.
 *
 * Two deliberate consequences, both about keeping the audit honest:
 *
 * 1. Confidence becomes 'grounded'. It is now literally their words — this is
 *    the only write in the system that may raise confidence, and it is safe
 *    precisely because a human typed it.
 *
 * 2. The risk is CLEARED, not kept. The old risk was written about text that no
 *    longer exists; leaving it attached to a rewritten section would show the
 *    founder a warning about a claim they just replaced. An empty risk is
 *    honest, a stale one is not — and Redraft regenerates it.
 */
export async function editSection(projectId: string, id: string, text: string): Promise<boolean> {
  if (!sectionById(id)) return false;
  const body = String(text ?? '').trim().slice(0, 4000);
  if (body.length < 3) return false;
  await run(
    `INSERT INTO north_star (project_id, sections)
     VALUES (?, ?)
     ON CONFLICT (project_id) DO UPDATE
       SET sections = north_star.sections || EXCLUDED.sections,
           updated_at = CURRENT_TIMESTAMP`,
    projectId,
    { [id]: { text: body, risk: '', confidence: 'grounded', updatedAt: new Date().toISOString() } },
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
