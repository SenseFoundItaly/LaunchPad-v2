/**
 * Addressable market scope — the founder's call before TAM/SAM/SOM.
 *
 * Changelog 05/09 item 7d. Until now the market-research run chose a geography
 * on its own, so a founder who will only ever sell to Italian dental practices
 * got a global TAM back. That number is not wrong so much as unusable: it reads
 * as ambition and it plans as fiction, and every downstream artifact (SAM, SOM,
 * revenue model, the gate's market_size evidence) inherits it.
 *
 * So the question is asked BEFORE the sizing, not corrected after it — which is
 * exactly how Luca phrased it. Two surfaces, deliberately:
 *
 *   1. `maybeProposeMarketScope` puts the question in chat as soon as the
 *      project reaches Stage 2, so it is already answered by the time the
 *      founder reaches for market sizing.
 *   2. `marketScopeRunBlocked` is the backstop for the founder who runs the
 *      skill first anyway — a clean 422 before anything is spent, same
 *      contract as the canvas and 1C gates.
 *
 * Founder-first, like every other proposer here: this only ASKS. Nothing picks
 * a scope on the founder's behalf and no run is rewritten behind their back.
 *
 * KNOWN GAP, stated rather than half-covered: the run_skill inbox executor
 * (action-executors.ts) applies no run-time gates at all — not this one, not
 * the canvas prereq, not 1C, not the stage lock. A market-research run approved
 * from the inbox therefore still runs unscoped, exactly as it does today. That
 * is a pre-existing hole in every gate, not one this opens, and blocking there
 * would fail an action the founder had already approved with no way to answer
 * the question first. In practice the proposer has already staged the card by
 * then: it fires on every chat turn while the project is in Stage 2 and the
 * scope is unanswered, which is upstream of any inbox proposal.
 */

import { query, run, get } from '@/lib/db';
import { generateId } from '@/lib/api-helpers';
import { recordEvent } from '@/lib/memory/events';
import { resolveLocale } from '@/lib/i18n/resolve-locale';
import { translate } from '@/lib/i18n/messages';
import type { Locale } from '@/lib/i18n/locales';
import { buildProjectSnapshot, activeStageFor } from '@/lib/journey';

/** The three scopes Luca named. Deliberately coarse: this steers a search, it
 *  is not a market definition, and a free-text geography would be unusable by
 *  the sizing prompt and unrenderable as a choice. */
export const MARKET_SCOPES = ['IT', 'EU', 'INTL'] as const;
export type MarketScope = (typeof MARKET_SCOPES)[number];

export function isMarketScope(v: unknown): v is MarketScope {
  return typeof v === 'string' && (MARKET_SCOPES as readonly string[]).includes(v);
}

/** Skills whose whole job is to size the market. Asking before these is the
 *  point; asking before every skill would be a toll booth. */
export const MARKET_SIZING_SKILLS = new Set<string>(['market-research']);

/** memory_events marker — an audit trail of when we asked, not a gate. */
export const MARKET_SCOPE_EVENT = 'market_scope_proposed' as const;

/** Stable artifact id fragment so an unanswered card is findable. */
const CARD_TAG = 'opt_market_scope';

export interface MarketScopeRecord {
  scope: MarketScope;
  decided_at: string;
}

/**
 * The recorded scope, or null when the founder has not been asked / answered.
 *
 * Deliberately NOT `.catch(() => null)`: that would turn "the query failed" into
 * "the founder hasn't answered", which reads as BLOCK on a database where 047
 * has not run — the opposite of what the migration promises. Callers catch and
 * decide; both of them fail open.
 */
export async function getMarketScope(projectId: string): Promise<MarketScopeRecord | null> {
  const row = await get<{ market_scope: unknown }>(
    'SELECT market_scope FROM research WHERE project_id = ?',
    projectId,
  );
  return readMarketScope(row?.market_scope);
}

/** Parse a market_scope value from a research row (or a snapshot's `research`).
 *  Tolerant of the jsonb arriving as a string, and of the column not existing
 *  at all on a database where 047 has not run. */
export function readMarketScope(value: unknown): MarketScopeRecord | null {
  let v = value;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return null; }
  }
  if (!v || typeof v !== 'object') return null;
  const scope = (v as { scope?: unknown }).scope;
  if (!isMarketScope(scope)) return null;
  const decidedAt = (v as { decided_at?: unknown }).decided_at;
  return { scope, decided_at: typeof decidedAt === 'string' ? decidedAt : '' };
}

/** Persist the founder's choice. Upserts because `research` may not exist yet
 *  on a project that has never run a research skill. */
export async function recordMarketScope(
  projectId: string,
  scope: MarketScope,
): Promise<MarketScopeRecord> {
  const record: MarketScopeRecord = { scope, decided_at: new Date().toISOString() };
  await run(
    `INSERT INTO research (project_id, market_scope) VALUES (?, ?)
       ON CONFLICT (project_id) DO UPDATE SET market_scope = EXCLUDED.market_scope`,
    projectId,
    JSON.stringify(record),
  );
  return record;
}

/**
 * True when this run must wait for the scope question.
 *
 * Non-throwing: a database problem here must not block a run the founder paid
 * for, so it fails OPEN. A missed question costs a re-run; a false block costs
 * the founder the feature.
 */
export async function marketScopeRunBlocked(projectId: string, skillId: string): Promise<boolean> {
  if (!MARKET_SIZING_SKILLS.has(skillId)) return false;
  try {
    return (await getMarketScope(projectId)) === null;
  } catch {
    return false;
  }
}

/** True when a scope card is already waiting in the thread — never stack two. */
async function scopeCardAlreadyOpen(projectId: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `SELECT id FROM chat_messages
      WHERE project_id = ? AND role = 'assistant' AND content LIKE ?
      LIMIT 1`,
    projectId,
    `%${CARD_TAG}%`,
  ).catch(() => [] as { id: string }[]);
  return rows.length > 0;
}

/** Build the card body. Exported so the run gate can hand the same question
 *  back on a 422 without a second copy of the copy. */
export function buildMarketScopeCard(projectId: string, locale: Locale): string {
  const options = MARKET_SCOPES.map((scope) => ({
    id: `market_scope_${scope}`,
    label: translate(locale, `market-scope.option-${scope}`),
    description: translate(locale, `market-scope.option-${scope}-desc`),
    market_scope: scope,
  }));
  const body = { prompt: translate(locale, 'market-scope.prompt'), options };
  return `:::artifact{"type":"option-set","id":"${CARD_TAG}_${projectId.slice(-8)}"}\n${JSON.stringify(body)}\n:::`;
}

/**
 * Ask the scope question once the project is doing market work.
 *
 * Guarded on STATE (no scope recorded) plus "no card already open", not on
 * history: the 2026-08-09 audit found a history guard turn a required step into
 * a dead end, and a founder who ignores this card must still be able to answer
 * it later. Asking again after a real answer is impossible — the scope is set.
 */
export async function maybeProposeMarketScope(projectId: string): Promise<boolean> {
  try {
    const proj = await query<{ owner_user_id: string | null }>(
      'SELECT owner_user_id FROM projects WHERE id = ?',
      projectId,
    );
    const ownerUserId = proj[0]?.owner_user_id || '';
    if (!ownerUserId) return false;

    if (await getMarketScope(projectId)) return false;
    if (await scopeCardAlreadyOpen(projectId)) return false;

    // Stage 2 is where market sizing lives. Asking in Stage 1 would interrupt a
    // founder still deciding what the product IS with a question about where to
    // sell it.
    const snapshot = await buildProjectSnapshot(projectId);
    if (activeStageFor(snapshot).stage.number !== 2) return false;

    const locale = await resolveLocale(ownerUserId, projectId);
    await run(
      `INSERT INTO chat_messages (id, project_id, step, role, content, "timestamp", user_id)
       VALUES (?, ?, 'chat', 'assistant', ?, ?, ?)`,
      generateId('msg'), projectId, buildMarketScopeCard(projectId, locale),
      new Date().toISOString(), ownerUserId,
    );
    await recordEvent({ userId: ownerUserId, projectId, eventType: MARKET_SCOPE_EVENT, payload: { locale } });
    return true;
  } catch (err) {
    console.warn('[market-scope] proposal failed (non-fatal):', (err as Error).message);
    return false;
  }
}

/** The context line handed to a skill run. Null when unanswered, so the prompt
 *  is unchanged for projects that predate this. */
export function marketScopeContextLine(research: unknown, locale: Locale = 'en'): string | null {
  const rec = readMarketScope((research as { market_scope?: unknown } | null)?.market_scope);
  if (!rec) return null;
  return translate(locale, `market-scope.context-${rec.scope}`);
}
