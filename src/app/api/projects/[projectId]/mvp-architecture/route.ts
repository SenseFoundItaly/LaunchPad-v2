import { NextRequest } from 'next/server';
import { query, get } from '@/lib/db';
import { json } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { marketSizingProse } from '@/lib/research-context';
import { coerceJson } from '@/lib/jsonb';

/**
 * GET /api/projects/{projectId}/mvp-architecture
 *
 * Changelog 05/09 item 13 — "integriamo una sezione 'MVP architecture' dove
 * reindirizzare queste roadmap tecniche + features, normative e tutto l'output
 * dello stage 1B", and item 7e, TAM/SAM/SOM's permanent home.
 *
 * Both live on the Knowledge page rather than in the graph or a new nav entry.
 * That is the founder's own instruction: the ad-hoc sections are "sempre
 * integrate alla knowledge", and the 2026-09-10 decision made the graph a
 * stakeholder map — a who, not a what. Stage-1B output is emphatically a what.
 *
 * Nothing new is stored. Every row here is already in memory_facts with a typed
 * `kind` (the gate families) or in research.market_size. The section is a READ
 * of evidence the founder already approved — which is why it can ship without a
 * migration and why it can never disagree with the gate.
 */

/** The six 1B families, in the order the gate asks for them. Kept as an
 *  explicit list rather than derived from GATE_FACT_FAMILIES: that table also
 *  holds 1A/2A families, and this section is specifically stage 1B. */
const MVP_SECTIONS = [
  { id: 'feasibility', kind: 'tech_feasibility_fact' },
  { id: 'risk', kind: 'tech_risk_fact' },
  { id: 'dependencies', kind: 'tech_dependency_fact' },
  { id: 'regulatory', kind: 'regulatory_fact' },
  { id: 'ip', kind: 'ip_fact' },
  { id: 'data', kind: 'data_fact' },
] as const;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const kinds = MVP_SECTIONS.map((s) => s.kind);
  const rows = await query<{ id: string; fact: string; kind: string; created_at: string }>(
    `SELECT id, fact, kind, created_at
       FROM memory_facts
      WHERE project_id = ?
        AND reviewed_state = 'applied'
        AND kind IN (${kinds.map(() => '?').join(', ')})
      ORDER BY created_at DESC`,
    projectId,
    ...kinds,
  ).catch(() => []);

  const sections = MVP_SECTIONS.map((s) => ({
    id: s.id,
    kind: s.kind,
    items: rows
      .filter((r) => r.kind === s.kind)
      .map((r) => ({ id: r.id, text: r.fact, created_at: r.created_at })),
  }));

  // Item 7e. The structured sizing the founder APPROVED (research.market_size
  // carries {approved:true} once the TAM/SAM/SOM card is applied) — the same
  // source the gate's market_size check reads, so the two can never disagree.
  const research = await get<{ market_size: unknown }>(
    'SELECT market_size FROM research WHERE project_id = ?',
    projectId,
  ).catch(() => null);
  const marketSize = coerceJson<Record<string, unknown>>(research?.market_size) ?? null;

  return json({
    sections,
    total: rows.length,
    market_sizing: marketSizingProse(marketSize),
  });
}
