/**
 * Deterministic persistence for research-shaped skill output.
 *
 * Why this exists: the market-research SKILL.md "Output Format" asks the model
 * for a fenced ```json {market_research:{…}}``` block, but skill-executor's
 * artifact loop only persists `:::artifact{…}` segments — so a perfectly good
 * market analysis persisted ZERO rows (confirmed live on a seeded EasyContract
 * clone: status=completed, real analysis, but research=NONE / graph_nodes=0).
 * That left "the graph didn't activate" half-broken even after context injection
 * fixed "what's your startup?".
 *
 * This module tolerantly extracts the market_research object from whatever
 * wrapping the model used (json fence / :::artifact / raw braces) and writes:
 *   - the `research` row (market_size, competitors, trends, sources)
 *   - one PENDING graph_node per competitor (node_type='competitor')
 *   - one PENDING market-sizing node
 * Pending = gate-respecting: nothing greens without the founder's approval; the
 * Canvas surfaces them as "proposed" (WS-3) with one-click apply.
 */

import { run, get } from '@/lib/db';
import { coerceJson } from '@/lib/jsonb';
import { marketSizeDrift, fmtAmount } from '@/lib/market-size-coherence';
import { persistCompetitorCategories } from '@/lib/competitor-categories';

// JSONB bind: pass the RAW value (postgres.js single-encodes). JSON.stringify here
// double-encoded into a string scalar; the ecosystem-monitors readers JSON.parse'd it back.
const jb = (v: unknown): unknown => v ?? null;
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

type ResearchObj = Record<string, unknown>;

/** Yield candidate JSON strings from a skill's text output, most-specific first. */
function* jsonCandidates(text: string): Generator<string> {
  for (const m of text.matchAll(/```(?:json)?\s*\n([\s\S]*?)\n```/g)) yield m[1];
  for (const m of text.matchAll(/:::artifact[^\n]*\n([\s\S]*?)\n:::/g)) yield m[1];
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) yield text.slice(first, last + 1);
}

/** Parse JSON, returning null on failure rather than throwing. */
function parseSafe(s: string | null): unknown {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

/** Return the COMPLETE balanced "key": {…}|[…] substring, or null if absent/truncated.
 *  Pure string scan (no dynamic RegExp) so a value truncated mid-stream still lets
 *  earlier complete sibling structures be recovered. */
function extractBalanced(text: string, key: string): string | null {
  const ki = text.indexOf(`"${key}"`);
  if (ki < 0) return null;
  let j = ki + key.length + 2; // past the closing quote of "key"
  while (j < text.length && ' \t\r\n:'.includes(text[j])) j++;
  const open = text[j];
  if (open !== '{' && open !== '[') return null; // scalar / absent value
  const close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false, esc = false;
  for (let i = j; i < text.length; i++) {
    const ch = text[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') { inStr = true; continue; }
    if (ch === open) depth++;
    else if (ch === close) { depth--; if (depth === 0) return text.slice(j, i + 1); }
  }
  return null; // truncated before its closing bracket
}

export interface ResearchFields {
  marketSizing: unknown;
  competitors: ResearchObj[];
  trends: unknown[];
  sources: unknown;
}

/**
 * Pull market-research fields out of skill output. Full parse first; falls back
 * to per-key balanced extraction so a response truncated mid-`trends` still
 * yields the competitors + market sizing that completed earlier (the common case
 * — the report routinely exceeds the model's output-token cap).
 */
export function extractResearchFields(text: string): ResearchFields | null {
  for (const c of jsonCandidates(text)) {
    const o = parseSafe(c.trim()) as ResearchObj | null;
    const mr = (o?.market_research as ResearchObj) ?? o ?? null;
    if (mr && (mr.market_sizing || mr.market_size || mr.competitors || mr.competitor_profiles)) {
      const competitors = asArray(mr.competitors).length ? asArray(mr.competitors) : asArray(mr.competitor_profiles);
      const trends = asArray(mr.trends).length ? asArray(mr.trends) : asArray(mr.market_trends);
      return { marketSizing: mr.market_sizing ?? mr.market_size ?? null, competitors: competitors as ResearchObj[], trends, sources: mr.sources ?? [] };
    }
  }
  // Truncated output — recover complete sub-structures individually.
  const marketSizing = parseSafe(extractBalanced(text, 'market_sizing') ?? extractBalanced(text, 'market_size'));
  const competitors = asArray(parseSafe(extractBalanced(text, 'competitors') ?? extractBalanced(text, 'competitor_profiles'))) as ResearchObj[];
  if (marketSizing || competitors.length) {
    const trends = asArray(parseSafe(extractBalanced(text, 'trends') ?? extractBalanced(text, 'market_trends')));
    return { marketSizing, competitors, trends, sources: [] };
  }
  return null;
}

/** Insert a graph_node as PENDING, deduped by LOWER(name) (mirrors artifact-persistence).
 *  Returns the node id + whether it was newly created, so the caller can attach
 *  competitor categories (the matryoshka) to it. Returns null on empty/error.
 *  An ALREADY-captured node returns its existing id (created:false) so categories
 *  can still be back-filled onto it — categories are additive and never downgrade
 *  the node's reviewed_state. */
async function upsertPendingNode(
  projectId: string,
  name: string,
  nodeType: string,
  summary: string,
  attributes: unknown,
  sources: unknown,
): Promise<{ id: string; created: boolean } | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  try {
    const existing = await get<{ id: string }>(
      'SELECT id FROM graph_nodes WHERE project_id = ? AND LOWER(name) = LOWER(?)',
      projectId,
      trimmed,
    );
    if (existing?.id) return { id: existing.id, created: false }; // captured — keep it, allow category back-fill
    const id = `node_${(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}${Math.round(performance.now())}`).replace(/-/g, '').slice(0, 12)}`;
    await run(
      `INSERT INTO graph_nodes (id, project_id, name, node_type, summary, attributes, sources, reviewed_state)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
      id,
      projectId,
      trimmed,
      nodeType,
      summary.slice(0, 500),
      jb(attributes),
      jb(sources),
    );
    return { id, created: true };
  } catch (err) {
    console.warn('[skill-research-persist] node upsert failed (non-fatal):', (err as Error).message);
    return null;
  }
}

export interface ResearchPersistResult {
  ok: boolean;
  competitors: number;
  marketSizeNode: boolean;
  /** Clean founder-readable markdown report, built from the parsed fields, to
   *  show in chat INSTEAD of the raw ```json dump (the json is machine-only —
   *  it exists to be parsed here, not read by the founder). */
  markdown?: string;
}

/**
 * Build a founder-readable markdown report from parsed research fields. Replaces
 * the raw ```json block in the chat message — TAM/SAM/SOM + competitors (with
 * threat level + pricing) + key trends, as headings/bullets the chat renderer
 * handles. The competitors also land in the knowledge graph (pending), so the
 * report points the founder there.
 */
export function renderResearchSummary(fields: ResearchFields): string {
  const { marketSizing, competitors, trends } = fields;
  const out: string[] = ['## Market research', ''];

  const ms = marketSizing && typeof marketSizing === 'object' ? (marketSizing as ResearchObj) : null;
  if (ms) {
    const tier = (k: string): string => {
      const t = ms[k] as ResearchObj | undefined;
      if (!t) return '';
      const est = str((t as ResearchObj)?.estimate ?? (t as ResearchObj)?.value ?? t);
      const conf = str((t as ResearchObj)?.confidence);
      return est ? `- **${k.toUpperCase()}:** ${est}${conf ? ` _(${conf} confidence)_` : ''}` : '';
    };
    const tiers = ['tam', 'sam', 'som'].map(tier).filter(Boolean);
    if (tiers.length) out.push('**Market size**', ...tiers, '');
  }

  if (competitors.length) {
    out.push(`**Competitors (${competitors.length})** — added to your graph as pending; approve them to build your ecosystem map`, '');
    for (const c of competitors) {
      const name = str(c?.name ?? c?.competitor ?? c?.company);
      if (!name) continue;
      const threat = str(c?.threat_level ?? c?.threat);
      const pricing = str(c?.pricing);
      const pos = str(c?.positioning ?? c?.description ?? c?.summary).slice(0, 160);
      const bits = [threat ? `threat: ${threat}` : '', pricing].filter(Boolean).join(' · ');
      out.push(`- **${name}**${bits ? ` — ${bits}` : ''}${pos ? `\n  ${pos}` : ''}`);
    }
    out.push('');
  }

  if (Array.isArray(trends) && trends.length) {
    out.push('**Key trends**', '');
    for (const t of trends as ResearchObj[]) {
      const name = str(t?.name);
      if (!name) continue;
      const dir = str(t?.direction);
      const impl = str(t?.implication).slice(0, 180);
      out.push(`- **${name}**${dir ? ` (${dir})` : ''}${impl ? ` — ${impl}` : ''}`);
    }
    out.push('');
  }

  return out.join('\n').trim();
}

/**
 * Persist research-skill output → research row + pending graph_nodes.
 * Only acts on skills whose output is the market_research schema. Non-fatal:
 * any failure degrades to ok:false; the skill_completions row writes regardless.
 */
export async function persistResearchFromSkillOutput(
  projectId: string,
  skillId: string,
  text: string,
): Promise<ResearchPersistResult> {
  const NONE = { ok: false, competitors: 0, marketSizeNode: false };
  if (skillId !== 'market-research') return NONE;

  const fields = extractResearchFields(text);
  if (!fields) return NONE;
  const { marketSizing, competitors, trends, sources } = fields;

  // F6 — market-size drift TELEMETRY (observe-only). A market-research re-run
  // overwrites the established TAM/SAM/SOM; if the canonical keeps moving, the
  // agent can't stay consistent across turns (F1 feeds it; F5 tells it to reuse).
  // We LOG a material drift so we can measure how often this happens before
  // deciding on enforcement (preserve/reconcile is a deliberate follow-up — a
  // hard preserve would lock out legitimately-better re-runs). Fully fail-open:
  // a broken check NEVER blocks the upsert and NEVER alters the incoming value.
  try {
    const prior = await get<{ market_size: unknown }>('SELECT market_size FROM research WHERE project_id = ?', projectId);
    const drift = marketSizeDrift(coerceJson<Record<string, unknown>>(prior?.market_size), marketSizing);
    if (drift) {
      console.log(`[coherence] market-size drift on re-run (project=${projectId}): ${drift.metric} ${fmtAmount(drift.oldAmount)} → ${fmtAmount(drift.newAmount)} (Δ${Math.round(drift.deltaPct * 100)}%)`);
    }
  } catch { /* telemetry only — never affects persistence */ }

  // research row (upsert — one per project).
  try {
    await run(
      // Never let an empty/failed re-parse wipe existing research. The
      // market-research parser is non-deterministic (a re-run can legitimately
      // complete yet yield 0 competitors); keep the prior value per-column
      // whenever the incoming field is json-null or an empty array/object.
      // jsonb_typeof — not IS NULL — because jb(null) serializes to JSON null.
      `INSERT INTO research (project_id, market_size, competitors, trends, sources, researched_at)
       VALUES (?, ?, ?, ?, ?, now())
       ON CONFLICT (project_id) DO UPDATE SET
         market_size = CASE WHEN jsonb_typeof(EXCLUDED.market_size) = 'object' AND EXCLUDED.market_size <> '{}'::jsonb
                            THEN EXCLUDED.market_size ELSE COALESCE(research.market_size, EXCLUDED.market_size) END,
         competitors = CASE WHEN jsonb_typeof(EXCLUDED.competitors) = 'array' AND jsonb_array_length(EXCLUDED.competitors) > 0
                            THEN EXCLUDED.competitors ELSE COALESCE(research.competitors, EXCLUDED.competitors) END,
         trends = CASE WHEN jsonb_typeof(EXCLUDED.trends) = 'array' AND jsonb_array_length(EXCLUDED.trends) > 0
                       THEN EXCLUDED.trends ELSE COALESCE(research.trends, EXCLUDED.trends) END,
         sources = CASE WHEN jsonb_typeof(EXCLUDED.sources) = 'array' AND jsonb_array_length(EXCLUDED.sources) > 0
                        THEN EXCLUDED.sources ELSE COALESCE(research.sources, EXCLUDED.sources) END,
         researched_at = now()`,
      projectId,
      jb(marketSizing),
      jb(competitors),
      jb(trends),
      jb(sources),
    );
  } catch (err) {
    console.warn('[skill-research-persist] research upsert failed (non-fatal):', (err as Error).message);
  }

  // pending competitor nodes + their matryoshka categories (item 14)
  let n = 0;
  for (const c of competitors) {
    const name = str(c?.name ?? c?.competitor ?? c?.company);
    const summary = str(c?.positioning ?? c?.description ?? c?.summary);
    const node = await upsertPendingNode(projectId, name, 'competitor', summary, c, c?.sources ?? sources);
    if (!node) continue;
    if (node.created) n++;
    // Decompose the competitor's attributes into canonical categories so the
    // graph shows the matryoshka (startup → competitor → category → detail),
    // not a flat node. Strip identity/source keys; the rest (positioning,
    // pricing, strengths, distribution, …) map to categories via categoryForColumn.
    // Best-effort + idempotent (ON CONFLICT upsert) — never breaks persistence.
    const { name: _n, competitor: _comp, company: _co, sources: _s, ...catAttrs } = c as Record<string, unknown>;
    if (Object.keys(catAttrs).length > 0) {
      await persistCompetitorCategories(projectId, node.id, catAttrs).catch((err) =>
        console.warn('[skill-research-persist] category persist failed (non-fatal):', (err as Error).message),
      );
    }
  }

  // pending market-sizing node (graph richness)
  let marketSizeNode = false;
  if (marketSizing && typeof marketSizing === 'object') {
    const ms = marketSizing as ResearchObj;
    const tam = str((ms.tam as ResearchObj)?.estimate ?? ms.tam);
    marketSizeNode = !!(await upsertPendingNode(
      projectId,
      'Market sizing (TAM/SAM/SOM)',
      'market',
      tam,
      marketSizing,
      sources,
    ));
  }

  return { ok: true, competitors: n, marketSizeNode, markdown: renderResearchSummary(fields) };
}
