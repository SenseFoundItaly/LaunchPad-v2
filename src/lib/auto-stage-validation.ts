/**
 * Deterministic validation capture from evidence artifacts.
 *
 * The chat agent reliably EMITS evidence artifacts (idea-canvas, tam-sam-som)
 * but — per the founder-sim 2026-06-14 — almost never calls `propose_validation`
 * to stage them, and those artifacts are "view-only" (persist nothing). Net: the
 * spine never advances from conversation. This closes that gap deterministically:
 * when such an artifact is persisted, we auto-stage a `validation_proposal`
 * pending_action (the SAME shape the propose_validation tool produces, consumed
 * by the applyValidationProposal executor), so the founder gets an approve-to-
 * green card in the Inbox WITHOUT relying on the model to call the tool.
 *
 * Gate-respecting: this only PROPOSES (pending) — nothing greens without the
 * founder's approval. Item shape mirrors stageValidationProposal in
 * project-tools.ts (kept in sync via the shared validation-targets mapping).
 */

import { query } from '@/lib/db';
import { createPendingAction, updateOpenProposalPayload, rejectPendingAction } from '@/lib/pending-actions';
import { resolveLocale } from '@/lib/i18n/resolve-locale';
import { translate } from '@/lib/i18n/messages';
import { validationTargetsFor, validationLabel, type ValidationItemKind } from '@/lib/journey/validation-targets';
import { KNOWLEDGE_APPLY_CREDITS } from '@/lib/credits';
import type { Artifact, IdeaCanvasArtifact, TamSamSomArtifact, Source } from '@/types/artifacts';

// Mirror of project-tools.ts CANVAS_FIELD_LABELS / itemDisplayLabel / itemCredits.
const CANVAS_FIELD_LABELS: Record<string, string> = {
  problem: 'Problem', solution: 'Solution', target_market: 'Target market',
  value_proposition: 'Value proposition', business_model: 'Business model',
  competitive_advantage: 'Competitive edge', channels: 'Channels',
};
const CANVAS_FIELDS = ['problem', 'solution', 'target_market', 'value_proposition', 'competitive_advantage', 'business_model', 'channels'] as const;
const TECH_FACT_LABELS: Record<string, string> = {
  feasibility: 'Technical feasibility', dependencies: 'Key dependencies', regulatory: 'Regulatory / compliance',
};
const PRICING_LABELS: Record<string, string> = {
  anchor_price: 'Anchor price', tiers: 'Pricing tiers', wtp: 'Willingness to pay',
  model: 'Revenue model', unit_econ: 'Unit economics',
};

interface RawItem {
  kind: ValidationItemKind;
  field?: string;
  name?: string;
  value: string;
  sources?: Source[];
  /** Structured payload for kinds that write typed rows (e.g. 'interview':
   *  person_role, top_pain, urgency, wtp_amount…). Flows through buildItems'
   *  spread into the stored proposal item; the apply executor reads it. */
  extra?: Record<string, unknown>;
}

function buildItems(raw: RawItem[]) {
  return raw
    .map((r) => ({ ...r, value: (r.value ?? '').trim().slice(0, 1600) }))
    .filter((r) => r.value.length > 0)
    .map((r, i) => {
      const targets = validationTargetsFor(r.kind, r.field);
      return {
        id: `item_${i}`,
        kind: r.kind,
        field: r.field,
        name: r.name,
        label: r.kind === 'canvas_field' ? (CANVAS_FIELD_LABELS[r.field ?? ''] ?? 'Idea Canvas')
          : r.kind === 'competitor' ? 'Competitor'
          : r.kind === 'tech_fact' ? (TECH_FACT_LABELS[r.field ?? ''] ?? 'Technical finding')
          : r.kind === 'interview' ? `Interview — ${r.name ?? 'logged'}`
          : r.kind === 'persona_fact' ? 'Ideal customer'
          : r.kind === 'channel_fact' ? 'Acquisition channel'
          : r.kind === 'pricing' ? (PRICING_LABELS[r.field ?? ''] ?? 'Pricing')
          : 'Market size',
        value: r.value,
        validates: validationLabel(targets),
        targets,
        credits: r.kind === 'canvas_field' ? 0 : KNOWLEDGE_APPLY_CREDITS,
        sources: Array.isArray(r.sources) ? r.sources : [],
        // Structured payload for typed-row kinds (interview: pain/WTP/urgency…)
        // — the apply executor reads it; absent for plain-value kinds.
        ...(r.extra ? { extra: r.extra } : {}),
      };
    });
}

/** Map a supported evidence artifact to raw validation items. Returns [] for
 *  artifact types we don't auto-capture (competitors already persist pending
 *  via persistComparisonTable; everything else is genuinely view-only). */
function rawItemsFor(artifact: Artifact): RawItem[] {
  if (artifact.type === 'idea-canvas') {
    const a = artifact as IdeaCanvasArtifact;
    const items: RawItem[] = [];
    for (const f of CANVAS_FIELDS) {
      const v = (a as unknown as Record<string, unknown>)[f];
      if (typeof v === 'string' && v.trim()) items.push({ kind: 'canvas_field', field: f, value: v, sources: a.sources });
    }
    return items;
  }
  if (artifact.type === 'tam-sam-som') {
    const a = artifact as TamSamSomArtifact;
    const parts = [a.tam?.value && `TAM ${a.tam.value}`, a.sam?.value && `SAM ${a.sam.value}`, a.som?.value && `SOM ${a.som.value}`].filter(Boolean);
    if (parts.length === 0) return [];
    const value = `Market size — ${parts.join(' · ')}${a.timeframe ? ` (${a.timeframe})` : ''}`;
    return [{ kind: 'market_size_fact', value, sources: a.sources }];
  }
  return [];
}

type StagedItem = ReturnType<typeof buildItems>[number];

interface OpenProposalRow {
  id: string;
  status: string;
  payload: unknown;
  edited_payload: unknown;
}

function parseJsonb(v: unknown): Record<string, unknown> | null {
  if (v == null) return null;
  if (typeof v === 'object') return v as Record<string, unknown>;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } }
  return null;
}

function itemsOf(payload: Record<string, unknown> | null): Record<string, unknown>[] {
  return Array.isArray(payload?.items) ? (payload.items as Record<string, unknown>[]) : [];
}

/** Two items compete for the same slot (same canvas field / same competitor /
 *  the one market-size item) — a reshape REPLACES the slot, never duplicates it. */
function sameSlot(a: Record<string, unknown>, b: StagedItem): boolean {
  if (a?.kind !== b.kind) return false;
  if (b.kind === 'canvas_field') return a.field === b.field;
  if (b.kind === 'competitor') {
    return typeof a.name === 'string' && typeof b.name === 'string'
      && a.name.trim().toLowerCase() === b.name.trim().toLowerCase();
  }
  // tech_fact: one slot PER finding (feasibility / dependencies / regulatory) —
  // without the field guard all three collapse into one and only the last
  // survives (cert 2026-07-07).
  if (b.kind === 'tech_fact') return a.field === b.field;
  return true; // market_size_fact — one sizing slot per proposal
}

async function openProposals(projectId: string): Promise<OpenProposalRow[]> {
  return query<OpenProposalRow>(
    `SELECT id, status, payload, edited_payload FROM pending_actions
      WHERE project_id = ? AND action_type = 'validation_proposal'
        AND status IN ('pending','edited')
      ORDER BY created_at DESC`,
    projectId,
  ).catch(() => [] as OpenProposalRow[]);
}

/**
 * Stage items founder-first, merging instead of refusing (audit B2 — the old
 * one-open-card dedup silently swallowed reshapes and the backstop re-injected
 * the STALE card; prod had 5 projects stuck this way):
 *   - every incoming value already staged verbatim on some open card → no-op;
 *   - an open AUTO card the founder hasn't touched (status 'pending' — an edit
 *     flips it to 'edited') absorbs the items in place, same-slot replace,
 *     non-matching items kept;
 *   - otherwise (founder-edited card, or chat/upload-origin proposals) a NEW
 *     card is created — a founder-edited proposal is never clobbered.
 */
async function stageOrMergeItems(
  projectId: string,
  items: StagedItem[],
  originNote: string,
): Promise<{ staged: boolean; pendingActionId?: string; itemCount?: number; merged?: boolean }> {
  const locale = await resolveLocale('', projectId);
  const evidenceTitle = (count: number) => translate(locale, 'pa.validation-evidence', { count });
  const open = await openProposals(projectId);

  const allStagedAlready = items.length > 0 && items.every((it) =>
    open.some((p) => itemsOf(parseJsonb(p.edited_payload) ?? parseJsonb(p.payload)).some(
      (e) => sameSlot(e, it) && typeof e.value === 'string' && e.value.trim() === it.value,
    )),
  );
  if (allStagedAlready) return { staged: false, pendingActionId: open[0]?.id };

  const target = open.find((p) => p.status === 'pending' && parseJsonb(p.payload)?.origin === 'auto');
  if (target) {
    const targetPayload = parseJsonb(target.payload) ?? {};
    const merged = [...itemsOf(targetPayload)];
    for (const it of items) {
      const i = merged.findIndex((e) => sameSlot(e, it));
      if (i >= 0) merged[i] = it as unknown as Record<string, unknown>;
      else merged.push(it as unknown as Record<string, unknown>);
    }
    const reindexed = merged.map((e, i) => ({ ...e, id: `item_${i}` }));
    const ok = await updateOpenProposalPayload(
      target.id,
      { ...targetPayload, origin: 'auto', items: reindexed },
      {
        title: evidenceTitle(reindexed.length),
        rationale: `Auto-staged from ${originNote} — founder approval gate. ${items.map((it) => it.validates ?? it.label).join('; ')}`.slice(0, 400),
      },
    );
    if (ok) return { staged: true, merged: true, pendingActionId: target.id, itemCount: reindexed.length };
    // The founder resolved the card mid-flight — fall through to a fresh one.
  }

  const pa = await createPendingAction({
    project_id: projectId,
    action_type: 'validation_proposal',
    title: evidenceTitle(items.length),
    rationale: `Auto-staged from ${originNote} — founder approval gate. ${items.map((it) => it.validates ?? it.label).join('; ')}`.slice(0, 400),
    payload: { origin: 'auto', items },
    estimated_impact: 'medium',
  });
  return { staged: true, pendingActionId: pa.id, itemCount: items.length };
}

/**
 * Auto-stage a validation_proposal from an evidence artifact. Reshape-safe:
 * merges into the one open auto card when the founder hasn't touched it,
 * creates a new card otherwise (see stageOrMergeItems). Returns {staged:false}
 * for unsupported artifacts, empty evidence, items that map to no gate, or when
 * every value is already staged. Never throws.
 */
/**
 * Digest & Prefill (brownfield founders): stage arbitrary RawItems from a
 * NON-artifact origin (document digestion) through the SAME founder-approval
 * gate as artifact auto-staging — nothing greens without the founder's Apply.
 * Thin exported wrapper over buildItems + stageOrMergeItems.
 */
export type RawValidationItem = RawItem;
export async function stageValidationItemsFromRaw(
  projectId: string,
  raw: RawItem[],
  originNote: string,
): Promise<{ staged: boolean; pendingActionId?: string; itemCount?: number; merged?: boolean }> {
  try {
    const items = buildItems(raw);
    if (items.length === 0) return { staged: false };
    return await stageOrMergeItems(projectId, items, originNote);
  } catch (err) {
    console.warn('[auto-stage] stageValidationItemsFromRaw failed (non-fatal):', (err as Error).message);
    return { staged: false };
  }
}

export async function autoStageValidationFromArtifact(
  projectId: string,
  artifact: Artifact,
): Promise<{ staged: boolean; pendingActionId?: string; itemCount?: number; merged?: boolean }> {
  try {
    const raw = rawItemsFor(artifact);
    if (raw.length === 0) return { staged: false };

    const items = buildItems(raw).filter((it) => it.targets.length > 0);
    if (items.length === 0) return { staged: false };

    return await stageOrMergeItems(projectId, items, `${artifact.type} artifact`);
  } catch {
    return { staged: false };
  }
}

/**
 * Deterministic approve-to-green card for market sizing (audit B4): the
 * market-research skill's research upsert used to leave the Stage-2
 * `market_size` check red with NO approval affordance — the pending
 * "Market sizing" graph node was a dead end. Called after the research row
 * persists; merge semantics mean an unrelated open canvas proposal never
 * blocks the sizing card, and identical re-runs stage nothing new.
 */
export async function stageMarketSizeProposal(
  projectId: string,
  tiers: { tam?: string; sam?: string; som?: string; timeframe?: string },
  sources: Source[] = [],
): Promise<{ staged: boolean; pendingActionId?: string; merged?: boolean }> {
  try {
    const parts = [
      tiers.tam?.trim() && `TAM ${tiers.tam.trim()}`,
      tiers.sam?.trim() && `SAM ${tiers.sam.trim()}`,
      tiers.som?.trim() && `SOM ${tiers.som.trim()}`,
    ].filter(Boolean);
    if (parts.length === 0) return { staged: false };
    const value = `Market size — ${parts.join(' · ')}${tiers.timeframe?.trim() ? ` (${tiers.timeframe.trim()})` : ''}`;

    const items = buildItems([{ kind: 'market_size_fact', value, sources }]).filter((it) => it.targets.length > 0);
    if (items.length === 0) return { staged: false };

    return await stageOrMergeItems(projectId, items, 'market-research skill');
  } catch {
    return { staged: false };
  }
}

/** Split a technical-validation summary into its three 1B findings. Each finding
 *  is prefixed with its label — so (a) the fact carries the check's own keyword
 *  even when the model's section text doesn't, and (b) the three facts are
 *  DISTINCT text (recordFact dedups by exact fact, so three identical
 *  full-summary facts would collapse to one). A section is used only when it's
 *  substantial and on-topic; otherwise the whole summary is the body (it's
 *  keyword-bearing across all three). Returns null when the text is too thin to
 *  be a real assessment. */
/** Label prefixes per finding — each contains its check's keyword (bilingual
 *  checks, so either language closes the gate), and keeps the fact text in the
 *  project language. */
const TECH_FINDING_PREFIX = {
  en: { feasibility: 'Technical feasibility', dependencies: 'Key dependencies', regulatory: 'Regulatory / compliance' },
  it: { feasibility: 'Fattibilità tecnica', dependencies: 'Dipendenze chiave', regulatory: 'Vincoli normativi / compliance' },
} as const;

export function extractTechnicalFindings(
  text: string,
  locale: 'en' | 'it' = 'it',
): { feasibility: string; dependencies: string; regulatory: string } | null {
  const clean = (text ?? '').trim();
  if (clean.length < 80) return null;
  const px = TECH_FINDING_PREFIX[locale] ?? TECH_FINDING_PREFIX.it;
  const full = clean.replace(/\s+/g, ' ').trim().slice(0, 1000);
  // Capture the body under a header matching the finding, up to the NEXT
  // markdown header (## / ###) — NOT a `---` divider (the skill uses those
  // between sections). Keep the section only if it's substantial AND actually
  // mentions the topic; else fall back to the full summary.
  const section = (headerRe: RegExp, topicRe: RegExp): string => {
    const m = clean.match(headerRe);
    if (!m) return full;
    const body = m[1].replace(/^[-\s#]+/, '').replace(/\s+/g, ' ').trim().slice(0, 900);
    return body.length >= 40 && topicRe.test(body) ? body : full;
  };
  const feasibility = section(
    /(?:feasibilit|fattibilit|technically|tecnicamente)[^\n]*\n+([\s\S]*?)(?:\n#{2,4}\s|$)/i,
    /fattibil|feasib|tecnic|architett|stack|rischio|build/i);
  const dependencies = section(
    /(?:dependenc|dipendenz)[^\n]*\n+([\s\S]*?)(?:\n#{2,4}\s|$)/i,
    /dipendenz|dependenc|API|infrastrutt|fornitor|terze parti|vendor|integrazion/i);
  const regulatory = section(
    /(?:regulat|normativ|compliance|conformit)[^\n]*\n+([\s\S]*?)(?:\n#{2,4}\s|$)/i,
    /normativ|regulat|GDPR|privacy|conformit|licen|garante|compliance/i);
  return {
    feasibility: `${px.feasibility} — ${feasibility}`.slice(0, 1000),
    dependencies: `${px.dependencies} — ${dependencies}`.slice(0, 1000),
    regulatory: `${px.regulatory} — ${regulatory}`.slice(0, 1000),
  };
}

/**
 * Deterministic approve-to-green card for the three 1B technical checks
 * (cert 2026-07-07: the technical-validation skill produced a rich prose
 * summary but `artifacts_persisted: 0` — no insight-cards parsed, so nothing
 * staged and the 1B gate could never close). Mirror of stageMarketSizeProposal:
 * parse the run's summary into feasibility/dependencies/regulatory findings and
 * stage ONE approve-to-green card carrying all three. Founder-first (pending
 * until approved). Called from skill-executor after a technical-validation run
 * only when the model emitted no parseable insight-cards.
 */
export async function stageTechnicalValidationProposal(
  projectId: string,
  summary: string,
  sources: Source[] = [],
): Promise<{ staged: boolean; pendingActionId?: string; merged?: boolean }> {
  try {
    const locale = await resolveLocale('', projectId);
    const findings = extractTechnicalFindings(summary, locale);
    if (!findings) return { staged: false };
    const items = buildItems([
      { kind: 'tech_fact', field: 'feasibility', value: findings.feasibility, sources },
      { kind: 'tech_fact', field: 'dependencies', value: findings.dependencies, sources },
      { kind: 'tech_fact', field: 'regulatory', value: findings.regulatory, sources },
    ]).filter((it) => it.targets.length > 0);
    if (items.length === 0) return { staged: false };
    return await stageOrMergeItems(projectId, items, 'technical-validation skill');
  } catch {
    return { staged: false };
  }
}

/**
 * Close open UNTOUCHED auto proposals made moot by a direct canvas apply
 * (audit A8): once the founder commits fields via POST /idea-canvas, an open
 * auto card whose items are ALL canvas fields now non-empty in idea_canvas is
 * a stale "pending update" overlay — reject it as superseded. Founder-edited
 * cards (status 'edited') and cards carrying any non-canvas item (paid
 * knowledge with its own approval affordance) are never touched. Returns the
 * number of cards closed. Never throws.
 */
export async function supersedeCoveredAutoProposals(projectId: string): Promise<number> {
  try {
    const rows = await query<Record<string, string | null>>(
      'SELECT problem, solution, target_market, value_proposition, business_model, competitive_advantage, channels FROM idea_canvas WHERE project_id = ?',
      projectId,
    );
    const canvas = rows[0];
    if (!canvas) return 0;

    let closed = 0;
    for (const p of await openProposals(projectId)) {
      if (p.status !== 'pending') continue;
      const pl = parseJsonb(p.payload);
      if (pl?.origin !== 'auto') continue;
      const items = itemsOf(pl);
      if (items.length === 0) continue;
      const allCovered = items.every((it) =>
        it.kind === 'canvas_field'
        && typeof it.field === 'string'
        && (canvas[it.field] ?? '').trim().length > 0,
      );
      if (!allCovered) continue;
      await rejectPendingAction(p.id, 'Superseded — canvas fields applied directly.')
        .then(() => { closed++; })
        .catch(() => {});
    }
    return closed;
  } catch {
    return 0;
  }
}
