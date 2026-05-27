/**
 * Watcher Proposer — auto-seeds the recurring-task surface from project context.
 *
 * Called when a project is first onboarded, or when the founder clicks
 * "Suggest watchers" from the new Signals page right-rail. Takes whatever
 * structured context the project has (idea, competitors, keywords) and asks
 * Sonnet to return 3-5 watchers tailored to *this* project — not a generic
 * list of monitors that every startup gets.
 *
 * Output is structured JSON; caller persists each accepted proposal as a
 * row in `monitors` (kind='scan'|'hybrid') or `watch_sources` (kind='diff').
 */

import { runAgent } from '@/lib/pi-agent';
import { pickModel } from '@/lib/llm/router';
import { recordUsage } from '@/lib/cost-meter';
import { buildSystemPromptString } from '@/lib/agent-prompt';
import type { WatcherTopic, WatcherKind, WatcherDepth, WatcherCadence } from '@/lib/watchers';

export interface ProjectContextForProposer {
  projectId: string;
  projectName: string;
  idea: {
    problem?: string;
    solution?: string;
    target_market?: string;
    value_proposition?: string;
  } | null;
  knownCompetitors: string[];
  keywords: string[];
  /** Watchers that already exist — used so the proposer doesn't duplicate. */
  existingWatcherNames: string[];
  locale: 'en' | 'it';
}

export interface ProposedWatcher {
  name: string;
  topic: WatcherTopic;
  kind: WatcherKind;
  depth: WatcherDepth;
  cadence: WatcherCadence;
  rationale: string;
  inputs: {
    urls?: string[];
    keywords?: string[];
    competitor_names?: string[];
  };
}

export interface ProposerResult {
  proposed: ProposedWatcher[];
  raw: string;
  skipped_reason?: string;
}

const VALID_TOPICS: WatcherTopic[] = [
  'competitors', 'ip', 'trends', 'partnerships', 'hiring',
  'sentiment', 'funding', 'regulatory', 'pricing', 'custom',
];
const VALID_KINDS: WatcherKind[] = ['scan', 'diff', 'hybrid'];
const VALID_DEPTHS: WatcherDepth[] = ['pulse', 'deep'];
const VALID_CADENCES: WatcherCadence[] = ['daily', 'weekly', 'monthly'];

/**
 * ─────────────────────────────────────────────────────────────────────────
 *  YOUR CONTRIBUTION (learning-mode hand-off)
 *
 *  The prompt below is what makes proposals feel "senior" instead of generic.
 *  Read the function signature & the surrounding code, then write the rules
 *  you want the model to follow when proposing watchers.
 *
 *  Things worth deciding (and why each one matters):
 *
 *  1) DEPTH RULES — when should a watcher be `deep` vs `pulse`?
 *     Deep = LLM synthesizes + cites sources every run, costs ~$0.05/run.
 *     Pulse = cheap URL hash diff, costs ~$0 but only fires on change.
 *     Bad default: everything deep → burns budget.
 *     Bad default: everything pulse → no synthesis, founder drowns in diffs.
 *
 *  2) CADENCE RULES — daily vs weekly vs monthly per topic?
 *     IP filings move slowly (weekly/monthly).
 *     Competitor pricing pages can change any day.
 *     Hiring signals matter on a week scale (one job posting ≠ signal).
 *
 *  3) NO-GENERICS RULE — what should DISQUALIFY a proposal?
 *     "Track competitor news" = useless.
 *     "Track Stripe's pricing page for changes to per-transaction fees" = useful.
 *     The model needs an explicit specificity bar to clear.
 *
 *  4) DEDUPE — model already sees `existingWatcherNames`, but tell it how
 *     to interpret near-duplicates (e.g. don't propose another hiring watcher
 *     if one exists, even with different keywords).
 *
 *  5) ANYTHING ELSE that reflects how you'd brief a founder choosing
 *     what to monitor for the first time.
 *
 *  Edit RULES_BLOCK below. Keep it terse — bullet points beat prose for
 *  prompt compliance. Aim for 8-15 bullets total. The OUTPUT CONTRACT
 *  underneath is fixed (the parser depends on it) — only touch the rules.
 * ─────────────────────────────────────────────────────────────────────────
 */
/**
 * NOTE — first-pass rules. Tune this to your founder voice; the prompt is
 * what makes proposals feel senior. The validator below rejects malformed
 * output regardless, so it's safe to iterate on wording without breaking
 * downstream code.
 */
const RULES_BLOCK = `
RULES — follow strictly, no exceptions:

VETO (the single hard rule — proposals violating this are silently dropped):
- Every proposal MUST include at least one named URL in inputs.urls.
- Keyword-only scans without a URL are forbidden, even if the keyword is highly
  specific. The reason: keyword-scan noise is the #1 thing founders triage and
  abandon. A URL anchors the watcher to something a human can verify and click.
- 'kind' MUST be 'diff' or 'hybrid'. Pure 'scan' (URL-less keyword search) is
  rejected by the validator — do not propose it.

SPECIFICITY (the bar that disqualifies generics):
- Each URL must point at a specific page that holds the answer:
  ✓ https://stripe.com/pricing  (pricing page diff)
  ✓ https://stripe.com/jobs/search?team=engineering  (eng hiring diff)
  ✓ https://patents.google.com/?q=("differential+privacy"+"telemetry")  (IP search)
  ✗ https://stripe.com  (homepage = no specific signal)
  ✗ https://news.ycombinator.com  (generic feed = not tied to this project)
- The URL must derive from THIS project's context block (a known competitor,
  the target market, a stated value-prop term). Generic feeds get rejected.

DEPTH SELECTION (deep is expensive, pulse is free):
- depth = 'pulse' (cheap URL hash diff) is the DEFAULT for any single-page watcher.
- depth = 'deep' (LLM synthesis with cited sources) ONLY when the URL is a
  search/aggregator page (USPTO query, news search, Google results) where the
  diff alone is uninformative without LLM interpretation.
- When in doubt, choose 'pulse'. The cost asymmetry is ~50×.

CADENCE (match the topic's natural rhythm):
- daily   — pricing, sentiment, ads, breaking competitive moves.
- weekly  — competitors, hiring, partnerships, trends, custom (default).
- monthly — ip, regulatory, funding (low base-rate events).
- Never propose hourly. Never propose 'manual' (defeats the point of a watcher).

KIND CONSISTENCY:
- kind = 'diff'   → inputs.urls only (1-3 URLs). No LLM call per run.
- kind = 'hybrid' → inputs.urls REQUIRED + keywords/competitors as filtering hints.
- kind = 'scan'   → FORBIDDEN per the VETO above.

DEDUPE (avoid near-duplicates of existing watchers):
- "Existing watchers" lists what's already running. Skip any topic the founder
  already covers — one watcher per topic per entity, not two with overlapping angles.
- If a competitor is in 'Known competitors', do not propose a generic watcher for
  them — propose a SPECIFIC page (their pricing, their careers, their changelog).

OUTPUT DISCIPLINE:
- 3-5 proposals total. Quality > quantity. Returning 3 sharp watchers beats 5 mediocre.
- Empty array [] is the right answer when context is too thin or every angle is covered.
- Rationale field MUST cite a specific context field (e.g. "covers value prop X"
  or "tracks competitor Y's pricing for ICP fit").
- No emojis, no markdown, no prose outside the JSON array.
`.trim();

const OUTPUT_CONTRACT = `
OUTPUT CONTRACT — JSON only, no prose, no markdown fence:
[
  {
    "name": "string — founder-facing label, <60 chars, no emojis",
    "topic": "competitors|ip|trends|partnerships|hiring|sentiment|funding|regulatory|pricing|custom",
    "kind": "scan|diff|hybrid",
    "depth": "pulse|deep",
    "cadence": "daily|weekly|monthly",
    "rationale": "string — <140 chars — WHY this watcher for THIS project, cite the context field",
    "inputs": {
      "urls": ["https://..."],            // required if kind=diff or hybrid
      "keywords": ["string"],             // required if kind=scan
      "competitor_names": ["string"]      // optional
    }
  }
]
Return 3-5 items. Empty array [] is allowed if the context is too thin.
`.trim();

export async function proposeWatchers(ctx: ProjectContextForProposer): Promise<ProposerResult> {
  // Guard: we need at least one signal of project intent. With nothing, the
  // model will hallucinate generic watchers — better to return [] than noise.
  const hasContext =
    !!ctx.idea?.problem || !!ctx.idea?.solution ||
    ctx.knownCompetitors.length > 0 || ctx.keywords.length > 0;
  if (!hasContext) {
    return { proposed: [], raw: '', skipped_reason: 'insufficient_context' };
  }

  const projectContext = [
    `## Project: ${ctx.projectName}`,
    ctx.idea?.problem && `Problem: ${ctx.idea.problem}`,
    ctx.idea?.solution && `Solution: ${ctx.idea.solution}`,
    ctx.idea?.target_market && `Target market: ${ctx.idea.target_market}`,
    ctx.idea?.value_proposition && `Value prop: ${ctx.idea.value_proposition}`,
    ctx.knownCompetitors.length > 0 && `Known competitors: ${ctx.knownCompetitors.join(', ')}`,
    ctx.keywords.length > 0 && `Keywords: ${ctx.keywords.join(', ')}`,
    `Existing watchers (do not duplicate): ${ctx.existingWatcherNames.join(', ') || '(none)'}`,
  ].filter(Boolean).join('\n');

  const systemPrompt = buildSystemPromptString({
    locale: ctx.locale,
    context: 'cron',
    tail: `You propose recurring watchers for a startup. ${RULES_BLOCK}\n\n${OUTPUT_CONTRACT}`,
    projectContext,
  });

  const startedAt = Date.now();
  let raw = '';
  let usage;
  try {
    const result = await runAgent('Propose watchers for this project now.', {
      systemPrompt,
      timeout: 60000,
      task: 'monitor-agent',
    });
    raw = result.text;
    usage = result.usage;
  } catch (err) {
    console.warn('[watcher-proposer] LLM call failed:', (err as Error).message);
    return { proposed: [], raw: '', skipped_reason: 'llm_failure' };
  }

  const latency = Date.now() - startedAt;
  const { provider, model } = pickModel('monitor-agent');
  recordUsage({
    project_id: ctx.projectId,
    step: 'watcher_proposer',
    provider,
    model,
    usage,
    latency_ms: latency,
  }).catch((err) => console.warn('[watcher-proposer] recordUsage failed:', (err as Error).message));

  const parsed = extractAndValidate(raw, ctx);
  return { proposed: parsed, raw };
}

// ---------------------------------------------------------------------------
// Parsing & validation — defensive because the model occasionally adds prose.
// ---------------------------------------------------------------------------

function extractAndValidate(raw: string, ctx: ProjectContextForProposer): ProposedWatcher[] {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  // Normalized name set for cross-proposal + against-existing dedupe.
  // Punctuation, casing, and connector words ("the", "for", "a") collapse so
  // "Track Stripe pricing" and "stripe-pricing-watcher" land on the same key.
  const norm = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\b(the|a|an|for|on|of|watcher|track|monitor)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const seenKeys = new Set<string>(ctx.existingWatcherNames.map(norm));
  const accepted: ProposedWatcher[] = [];

  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;

    const name = typeof o.name === 'string' ? o.name.trim().slice(0, 80) : '';
    if (!name) continue;
    const nameKey = norm(name);
    if (!nameKey || seenKeys.has(nameKey)) continue;

    const topic = isOneOf(o.topic, VALID_TOPICS) ? (o.topic as WatcherTopic) : 'custom';
    const kind = isOneOf(o.kind, VALID_KINDS) ? (o.kind as WatcherKind) : 'scan';
    // Default to 'pulse' when the model omits depth — cheap URL diff is the
    // safer default; 'deep' burns LLM budget per run and only pays off when
    // the watcher specifically needs multi-source synthesis.
    const depth = isOneOf(o.depth, VALID_DEPTHS) ? (o.depth as WatcherDepth) : 'pulse';
    const cadence = isOneOf(o.cadence, VALID_CADENCES) ? (o.cadence as WatcherCadence) : 'weekly';

    const rationale = typeof o.rationale === 'string' ? o.rationale.slice(0, 240) : '';

    const inputsRaw = (o.inputs || {}) as Record<string, unknown>;
    const inputs: ProposedWatcher['inputs'] = {};
    if (Array.isArray(inputsRaw.urls)) {
      inputs.urls = inputsRaw.urls.filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u)).slice(0, 10);
    }
    if (Array.isArray(inputsRaw.keywords)) {
      inputs.keywords = inputsRaw.keywords.filter((k): k is string => typeof k === 'string').slice(0, 15);
    }
    if (Array.isArray(inputsRaw.competitor_names)) {
      inputs.competitor_names = inputsRaw.competitor_names.filter((c): c is string => typeof c === 'string').slice(0, 10);
    }

    // VETO: every accepted proposal must include at least one named URL.
    // Pure 'scan' kind is rejected outright — the prompt forbids it but defend
    // against models that ignore the rule. URL-less proposals are the #1 source
    // of low-quality watcher noise; better to return fewer proposals than any.
    if (!inputs.urls || inputs.urls.length === 0) continue;
    if (kind === 'scan') continue;

    // Secondary dedupe: same topic + same primary input host = duplicate angle.
    // Catches "Stripe pricing page" + "Stripe plans page diff" both proposing
    // the same canonical domain, which the name-key alone would miss.
    const primaryInputKey = buildPrimaryInputKey(topic, inputs);
    if (primaryInputKey && seenKeys.has(primaryInputKey)) continue;

    accepted.push({ name, topic, kind, depth, cadence, rationale, inputs });
    seenKeys.add(nameKey);
    if (primaryInputKey) seenKeys.add(primaryInputKey);
    if (accepted.length >= 5) break;
  }

  return accepted;
}

function buildPrimaryInputKey(topic: WatcherTopic, inputs: ProposedWatcher['inputs']): string | null {
  if (inputs.urls?.[0]) {
    try {
      const host = new URL(inputs.urls[0]).hostname.replace(/^www\./, '');
      return `${topic}@${host}`;
    } catch { /* malformed URL — fall through */ }
  }
  if (inputs.competitor_names?.[0]) {
    return `${topic}@${inputs.competitor_names[0].toLowerCase().trim()}`;
  }
  if (inputs.keywords?.[0]) {
    return `${topic}@${inputs.keywords[0].toLowerCase().trim()}`;
  }
  return null;
}

function isOneOf<T extends string>(v: unknown, allowed: T[]): boolean {
  return typeof v === 'string' && (allowed as string[]).includes(v);
}
