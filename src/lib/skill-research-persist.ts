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

const jb = (v: unknown): string => JSON.stringify(v ?? null);
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

/** Insert a graph_node as PENDING, deduped by LOWER(name) (mirrors artifact-persistence). */
async function upsertPendingNode(
  projectId: string,
  name: string,
  nodeType: string,
  summary: string,
  attributes: unknown,
  sources: unknown,
): Promise<boolean> {
  const trimmed = name.trim();
  if (!trimmed) return false;
  try {
    const existing = await get<{ id: string }>(
      'SELECT id FROM graph_nodes WHERE project_id = ? AND LOWER(name) = LOWER(?)',
      projectId,
      trimmed,
    );
    if (existing?.id) return false; // already captured — never downgrade an applied node
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
    return true;
  } catch (err) {
    console.warn('[skill-research-persist] node upsert failed (non-fatal):', (err as Error).message);
    return false;
  }
}

export interface ResearchPersistResult {
  ok: boolean;
  competitors: number;
  marketSizeNode: boolean;
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

  // research row (upsert — one per project).
  try {
    await run(
      `INSERT INTO research (project_id, market_size, competitors, trends, sources, researched_at)
       VALUES (?, ?, ?, ?, ?, now())
       ON CONFLICT (project_id) DO UPDATE SET
         market_size = EXCLUDED.market_size,
         competitors = EXCLUDED.competitors,
         trends = EXCLUDED.trends,
         sources = EXCLUDED.sources,
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

  // pending competitor nodes
  let n = 0;
  for (const c of competitors) {
    const name = str(c?.name ?? c?.competitor ?? c?.company);
    const summary = str(c?.positioning ?? c?.description ?? c?.summary);
    if (await upsertPendingNode(projectId, name, 'competitor', summary, c, c?.sources ?? sources)) n++;
  }

  // pending market-sizing node (graph richness)
  let marketSizeNode = false;
  if (marketSizing && typeof marketSizing === 'object') {
    const ms = marketSizing as ResearchObj;
    const tam = str((ms.tam as ResearchObj)?.estimate ?? ms.tam);
    marketSizeNode = await upsertPendingNode(
      projectId,
      'Market sizing (TAM/SAM/SOM)',
      'market',
      tam,
      marketSizing,
      sources,
    );
  }

  return { ok: true, competitors: n, marketSizeNode };
}
