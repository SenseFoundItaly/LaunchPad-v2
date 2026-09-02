/**
 * Deterministic grant ranking — NO model calls, ever.
 *
 * Scores each open call against signals extracted from what the founder has
 * already written while validating with the Co-pilot (project-signals.ts). Pure
 * arithmetic over a closed vocabulary: the same project and the same calls
 * always produce the same order, it runs in well under a millisecond per call,
 * and every point is attributable to a named reason the UI can show.
 *
 * The three sources carry different metadata, so each gets an honest treatment:
 *   - incentivi  — full facets + regions; scored on all terms.
 *   - lombardia  — no facets, but the source itself means the region.
 *   - sedia      — EU-wide; treated as everywhere-eligible, scored on text.
 * A call is never HIDDEN by this module. Region inference is a guess from prose,
 * so a wrong guess must cost rank, never visibility; explicit filtering stays
 * with the founder's own region selector.
 */

import type { FundingCallView, MatchReason, RelevanceResult } from './view';
import type { ProjectSignals } from './project-signals';
import { normalize } from './project-signals';

export type RankedCall = FundingCallView & { relevance: RelevanceResult };

// Weights. Region dominates because it is the one criterion that makes a call
// flatly inapplicable; everything else is a matter of degree.
const W_REGION = 40;
/** Region match with nothing else corroborating it — a hint, not a finding. */
const W_REGION_ALONE = 12;
const W_NATIONAL = 10;
const W_SCOPE = 26;
const MAX_SCOPES = 3;
const W_SUBJECT = 30;
const MAX_SUBJECTS = 2;
const W_TERMS_MAX = 20;
const W_TERM_UNIT = 7;
/** Below this a word is corpus boilerplate, not a topic. */
const MIN_TERM_IDF = 0.55;
const W_CLOSING_SOON = 4;
const P_REGION_MISMATCH = -35;
/**
 * With no region known, a scheme open to one or two regions is a long shot
 * while a national one is not. Without this the top of the list fills with
 * municipal schemes from wherever, which is exactly what the first live run
 * produced (2026-09-02: a Sicilian comune ranked first for a Milan SaaS).
 */
const P_NARROW_UNKNOWN_REGION = -12;
const NARROW_REGION_COUNT = 2;

const CLOSING_SOON_DAYS = 30;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * How much a facet match is worth, by how rare that facet is in the corpus.
 *
 * Measured live: `Impresa` sits on 581 of 659 tagged calls and `Sostegno
 * investimenti` on 259, so matching them says almost nothing; `Imprenditoria
 * femminile` (48) says a great deal. Weighting every match equally made the
 * ranking noise. This is plain inverse document frequency, normalised to 0..1,
 * computed once per request over the calls actually being ranked.
 */
export interface FacetIdf {
  scopes: Map<string, number>;
  subjects: Map<string, number>;
  /** Same treatment for free-text words: boilerplate present in most calls
   *  ("domanda", "impresa", "euro", "hanno") must contribute nothing. */
  terms: Map<string, number>;
  /** Content words per call id, computed once so scoring does not re-tokenise. */
  termsByCall: Map<string, Set<string>>;
}

function idfOf(df: number, total: number): number {
  if (total <= 1) return 1;
  return Math.min(1, Math.log(total / (df + 1)) / Math.log(total));
}

export function buildFacetIdf(calls: FundingCallView[]): FacetIdf {
  const scopeDf = new Map<string, number>();
  const subjectDf = new Map<string, number>();
  const termDf = new Map<string, number>();
  const termsByCall = new Map<string, Set<string>>();
  for (const c of calls) {
    for (const v of c.facets?.scopes ?? []) scopeDf.set(v, (scopeDf.get(v) ?? 0) + 1);
    for (const v of c.facets?.subject_types ?? []) subjectDf.set(v, (subjectDf.get(v) ?? 0) + 1);
    const words = callTerms(c);
    termsByCall.set(c.id, words);
    for (const w of words) termDf.set(w, (termDf.get(w) ?? 0) + 1);
  }
  const total = calls.length;
  const scopes = new Map<string, number>();
  const subjects = new Map<string, number>();
  const terms = new Map<string, number>();
  for (const [k, df] of scopeDf) scopes.set(k, idfOf(df, total));
  for (const [k, df] of subjectDf) subjects.set(k, idfOf(df, total));
  for (const [k, df] of termDf) terms.set(k, idfOf(df, total));
  return { scopes, subjects, terms, termsByCall };
}

/** Calls from this source apply regardless of Italian region. */
function isBorderless(call: FundingCallView): boolean {
  return call.source === 'sedia' || call.facets?.national === true;
}

/** Regions a call applies to, including the ones implied by its source. */
function callRegions(call: FundingCallView): string[] {
  if (call.regions && call.regions.length > 0) return call.regions;
  if (call.source === 'lombardia') return ['Lombardia'];
  return [];
}

function daysUntil(deadline: string | null, now: Date): number | null {
  if (!deadline) return null;
  const m = deadline.match(ISO_DATE_RE);
  if (!m) return null;
  const target = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86_400_000);
}

/** Content words of a call, for the text-overlap term. */
function callTerms(call: FundingCallView): Set<string> {
  const text = ` ${normalize(`${call.title} ${call.granting_body ?? ''} ${call.eligibility_text ?? ''}`)} `;
  return new Set(text.split(' ').filter((w) => w.length > 3));
}

export function scoreCall(
  call: FundingCallView,
  signals: ProjectSignals,
  now: Date,
  idf: FacetIdf,
): RelevanceResult {
  const reasons: MatchReason[] = [];
  let score = 0;

  // ── Scopes: what the money is for ────────────────────────────────────────
  const scopes = call.facets?.scopes ?? [];
  let scopeHits = 0;
  for (const scope of scopes) {
    if (scopeHits >= MAX_SCOPES) break;
    // Facet labels can be long ("Formazione (lavoro, …)"); compare on the head.
    const head = scope.split('(')[0].trim();
    if (signals.scopes.some((s) => s === scope || s === head)) {
      const weight = Math.round(W_SCOPE * (idf.scopes.get(scope) ?? 0.5));
      if (weight > 0) {
        score += weight;
        scopeHits++;
        reasons.push({ kind: 'scope', label: head });
      }
    }
  }

  // ── Subject types: who may apply ─────────────────────────────────────────
  const subjects = call.facets?.subject_types ?? [];
  let subjectHits = 0;
  for (const subject of subjects) {
    if (subjectHits >= MAX_SUBJECTS) break;
    if (signals.subjectTypes.includes(subject)) {
      const weight = Math.round(W_SUBJECT * (idf.subjects.get(subject) ?? 0.5));
      if (weight > 0) {
        score += weight;
        subjectHits++;
        reasons.push({ kind: 'subject', label: subject });
      }
    }
  }

  // ── Text overlap: the only signal available for EU and Lombardy rows ─────
  let termHits = 0;
  if (signals.terms.length > 0) {
    const words = idf.termsByCall.get(call.id) ?? callTerms(call);
    // Weight each shared word by how rare it is across the corpus, so a match
    // on "manifatturiere" counts and a match on "hanno" does not.
    const shared = signals.terms
      .filter((t) => words.has(t))
      .map((t) => ({ t, w: idf.terms.get(t) ?? 0.5 }))
      .filter((x) => x.w >= MIN_TERM_IDF)
      .sort((a, b) => b.w - a.w);
    if (shared.length > 0) {
      const mass = shared.reduce((n, x) => n + x.w, 0);
      score += Math.round(Math.min(W_TERMS_MAX, W_TERM_UNIT * mass));
      termHits = shared.length;
      for (const x of shared.slice(0, 3)) reasons.push({ kind: 'term', label: x.t });
    }
  }

  /**
   * Being in the founder's region is NECESSARY but not SUFFICIENT. Measured on
   * 2026-09-02: a Milan project with no topical signal put thesis prizes and a
   * mountain-guide course at the top, because region alone outweighed
   * everything. Region therefore pays full only when something else about the
   * call also matches; on its own it is a weak hint.
   */
  const corroborated = scopeHits > 0 || subjectHits > 0 || termHits >= 2;

  // ── Region ────────────────────────────────────────────────────────────────
  const regions = callRegions(call);
  if (isBorderless(call)) {
    score += W_NATIONAL;
    reasons.push({ kind: 'national', label: call.source === 'sedia' ? 'EU' : 'Nazionale' });
  } else if (regions.length > 0 && signals.regions.length > 0) {
    const hit = regions.find((r) => signals.regions.includes(r));
    if (hit) {
      score += corroborated ? W_REGION : W_REGION_ALONE;
      reasons.push({ kind: 'region', label: hit });
    } else {
      // Tagged for other regions only: almost certainly not applicable. Sinks,
      // never hidden — the region came from prose and prose can be wrong.
      score += P_REGION_MISMATCH;
    }
  } else if (regions.length > 0 && regions.length <= NARROW_REGION_COUNT) {
    // Region unknown: a very local scheme cannot be ruled out, but it must not
    // outrank measures that apply everywhere.
    score += P_NARROW_UNKNOWN_REGION;
  }

  // ── Urgency: among equals, what closes sooner is worth more now ──────────
  const days = daysUntil(call.deadline, now);
  if (days !== null && days >= 0 && days <= CLOSING_SOON_DAYS) {
    score += W_CLOSING_SOON;
    reasons.push({ kind: 'closing', label: String(days) });
  }

  return { score, reasons };
}

/**
 * Rank calls for a project. Stable and total: equal scores fall back to the
 * page's existing order (deadline ascending, nulls last, then title), so the
 * list never reshuffles between identical requests.
 */
export function rankCalls(
  calls: FundingCallView[],
  signals: ProjectSignals,
  now: Date,
): RankedCall[] {
  const idf = buildFacetIdf(calls);
  const scored: RankedCall[] = calls.map((c) => ({ ...c, relevance: scoreCall(c, signals, now, idf) }));
  return scored.sort((a, b) => {
    if (b.relevance.score !== a.relevance.score) return b.relevance.score - a.relevance.score;
    if (a.deadline !== b.deadline) {
      if (a.deadline === null) return 1;
      if (b.deadline === null) return -1;
      return a.deadline < b.deadline ? -1 : 1;
    }
    return a.title.localeCompare(b.title);
  });
}

/**
 * Score above which a call is worth showing under "relevant to your project".
 * A bare national/EU tag (10) must NOT clear it on its own — that would make
 * every EU call "relevant" and the shortlist meaningless.
 */
export const RELEVANT_THRESHOLD = 20;

export function relevantOnly(ranked: RankedCall[]): RankedCall[] {
  return ranked.filter((c) => c.relevance.score >= RELEVANT_THRESHOLD);
}
