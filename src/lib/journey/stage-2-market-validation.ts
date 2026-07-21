/**
 * Stage 2 — Validation Gate (L2 Phase 1).
 * Evidence that the problem is real, painful, and frequent enough that
 * someone would pay to solve it — and that you can name why you win.
 *
 * Three sub-tracks per the L2 walkthrough §2:
 *   1A Market    — problem, segment, competitors, sizing, differentiation,
 *                  L1 watchers. Runs in parallel with 1B.
 *   1B Technical — feasibility, dependencies, regulatory. Parallel with 1A.
 *   1C Problem-Solution Fit — customer interviews, verbatim pain, WTP signal.
 *                  LOCKED until every 1A + 1B check passes: interviews come
 *                  AFTER the desk validation, not before.
 *
 * Re-bucketing note (2026-07 L2 Phase-1 alignment): `interviews_logged` and
 * `pain_validated` moved 1A → 1C (ids kept — the walkthrough is unambiguous
 * that interviews belong to PSF); `wtp_signal` is NEW ("captured", not the
 * Loop-1 ≥30% threshold); `market_size` is structured-first (reads the
 * research.market_size column the tam-sam-som approval card persists, keyword
 * fallback for legacy prose-sized projects).
 */

import type { Stage, StageCheck, ProjectSnapshot } from './types';
import { CANONICAL_BY_ID } from './canonical';
import { countMemoryFactsMatching } from './snapshot';
import { coerceJson } from '@/lib/jsonb';

/** The market_size check's `source` string. validation-targets.ts keys the
 *  `market_size_fact` reverse-map on this EXACT string — import it there,
 *  never re-type it, so the two can't drift byte-wise. */
export const MARKET_SIZE_CHECK_SOURCE = 'research.market_size + memory_facts (market sizing)';

/** The bilingual (EN + IT) keyword list the market_size check's prose fallback
 *  counts. The save_memory_fact spine-moving gate in project-tools.ts MUST test
 *  the exact same list — a fact matching here while slipping past the gate
 *  auto-applies and greens the check with no founder yes. The gate once kept
 *  its own English-only copy and the Italian phrases below drifted past it
 *  (2026-07-10 audit INV5): "mercato totale ~30 miliardi" greened the check
 *  ungated. Import this constant, never re-type it. */
export const MARKET_SIZE_KEYWORDS = [
  'market size', 'TAM', 'SAM', 'SOM', 'addressable',
  'dimensione del mercato', 'dimensione di mercato', 'mercato totale', 'mercato indirizzabile',
] as const;

/** The three 1B check `source` strings — exported so validation-targets.ts can
 *  map the `tech_fact` item kind onto them without re-typing (drift-proof, same
 *  discipline as MARKET_SIZE_CHECK_SOURCE). Keyed by the finding discriminator
 *  the technical-validation fallback stages. */
export const TECH_1B_SOURCES = {
  feasibility: 'memory_facts (feasibility)',
  dependencies: 'memory_facts (dependencies)',
  regulatory: 'memory_facts (regulatory)',
} as const;

/** The 1A trends/persona check `source` strings — exported for the same
 *  drift-proof mapping: skill-research-persist stages `trend_fact` /
 *  `buyer_persona_fact` items from the market-research skill's parsed JSON
 *  (§3 trends, §5 customer_insights), and validation-targets resolves them
 *  onto these checks by source. */
export const MARKET_1A_SOURCES = {
  trends: 'memory_facts (market trends)',
  persona: 'memory_facts (buyer persona)',
} as const;

/** Non-empty TAM text from research.market_size — but ONLY once the founder
 *  approved it. The column is ALSO written ungated at artifact-emission time
 *  (the cross-turn reference write in artifact-persistence.ts, plus market
 *  metric-grids); counting those would green the check with no founder yes —
 *  the exact finding_validation_gate_bypasses class. applyValidationProposal
 *  stamps `{approved, approved_at, approved_value}` into the JSONB when the
 *  market_size item is applied; approved_value snapshots the approved tiers,
 *  so it is preferred over the top-level tam (which ungated writers may have
 *  since replaced — the stamp is carried across but the tiers move).
 *  Tolerates the legacy double-encoded shape and both {value}/{estimate}
 *  tier keys. */
function structuredTam(research: Record<string, unknown> | null): string {
  if (!research) return '';
  const ms = coerceJson<Record<string, unknown>>(research.market_size);
  if (!ms || typeof ms !== 'object') return '';
  if ((ms as { approved?: unknown }).approved !== true) return '';
  const tierText = (tam: unknown): string => {
    if (typeof tam === 'string') return tam.trim();
    if (tam && typeof tam === 'object') {
      const t = tam as { value?: unknown; estimate?: unknown };
      if (typeof t.value === 'string' && t.value.trim()) return t.value.trim();
      if (typeof t.estimate === 'string' && t.estimate.trim()) return t.estimate.trim();
    }
    return '';
  };
  const av = (ms as { approved_value?: unknown }).approved_value;
  const approvedTam = av && typeof av === 'object' ? tierText((av as { tam?: unknown }).tam) : '';
  return approvedTam || tierText((ms as { tam?: unknown }).tam);
}

// ── Track 1A — Market ────────────────────────────────────────────────────────
// Phase-0 vs Phase-1 separation (walkthrough §3): Phase 0 (Stage 1 — Idea
// Canvas) is where the founder DEFINES the assumptions (problem, solution,
// target/ICP, value prop, edge…) — the "internal contract". Phase 1 (this gate)
// VALIDATES them with external EVIDENCE. So the old `problem_defined` and
// `segment_named` checks were REMOVED from here (2026-07): they only re-verified
// that `idea_canvas.problem` / `.target_market` are filled — which Stage 1's
// `problem_defined` / `target_icp_defined` already own. The gate now validates
// the market itself (competitors, sizing, differentiation); whether the problem
// is REAL and the segment is right is proven by the 1C interviews, not by
// re-reading the canvas field.
export const VALIDATION_TRACK_1A: StageCheck[] = [
  {
    id: 'competitors_mapped',
    label: '3+ competitors mapped',
    source: 'competitor_profiles',
    track: '1A',
    evaluate: (s) => {
      const n = s.competitors.length;
      const ok = n >= 3;
      return ok
        ? { passed: true, evidence: `You've mapped ${n} competitors in your space.` }
        : { passed: false, gap: `${n} of 3 — ask Co-pilot to research more` };
    },
  },
  {
    id: 'market_size',
    label: 'Market size estimated',
    source: MARKET_SIZE_CHECK_SOURCE,
    track: '1A',
    evaluate: (s) => {
      // Structured-first: once the founder APPROVES the tam-sam-som card,
      // research.market_size carries {approved: true} — authoritative then.
      const tam = structuredTam(s.research);
      if (tam) {
        return { passed: true, evidence: `You've sized the market — TAM ${tam}.` };
      }
      // Keyword fallback (bilingual EN + IT) for projects that sized the
      // market in prose (approved market_size_fact → memory_facts).
      const n = countMemoryFactsMatching(s, [...MARKET_SIZE_KEYWORDS]);
      const ok = n > 0;
      return ok
        ? { passed: true, evidence: "You've sized the market (TAM/SAM/SOM)." }
        : { passed: false, gap: 'Estimate TAM/SAM with Co-pilot' };
    },
  },
  {
    id: 'differentiation_evidence',
    label: 'Differentiation evidenced',
    source: 'memory_facts (vs. competitors)',
    track: '1A',
    evaluate: (s) => {
      // NOTE: 'vs' was removed — as a bare substring it matched almost any
      // comparison ("email vs calls"), letting unrelated facts falsely green
      // this check. The remaining phrases are specific differentiation signals.
      // Bilingual (EN + IT). 'differenz' stem catches differenza/differenziamo/
      // differenziazione; "a differenza di" / "ci distinguiamo" / "rispetto a"
      // are the IT prose forms (all three phrasings SKILL.it.md instructs).
      const n = countMemoryFactsMatching(s, [
        'unlike', 'better than', 'differentiator', 'compared to',
        'a differenza di', 'differenz', 'meglio di', 'ci distinguiamo', 'rispetto a',
      ]);
      const ok = n > 0;
      return ok
        ? { passed: true, evidence: "You've evidenced how you're different from competitors." }
        : { passed: false, gap: 'Pin what makes you different in chat' };
    },
  },
  {
    id: 'trends_assessed',
    label: 'Market trends assessed (tailwinds/headwinds)',
    source: MARKET_1A_SOURCES.trends,
    track: '1A',
    evaluate: (s) => {
      // 2026-07 alpha feedback: the gate's market track was too thin. The
      // market-research skill's §3 (Market Trends) already produces this
      // content — its insight-cards, once applied, close the check.
      // Bilingual (EN + IT). Bare 'trend' is deliberately absent (it matches
      // almost any metric sentence); 'tendenz' stem catches tendenza/tendenze.
      // Like the rest of the keyword checks these auto-apply from chat — the
      // founder stated the fact, which is the founder yes (only market SIZING
      // is spine-moving-gated, see MARKET_SIZE_KEYWORDS).
      const n = countMemoryFactsMatching(s, [
        'tailwind', 'headwind', 'market trend', 'market shift', 'growth rate',
        'trend di mercato', 'tendenz', 'vento a favore', 'vento contrario', 'in crescita', 'in calo',
      ]);
      return n > 0
        ? { passed: true, evidence: "You've assessed the trends shaping this market." }
        : { passed: false, gap: 'Assess the market trends — tailwinds and headwinds (run Market Research or note them in chat)' };
    },
  },
  {
    id: 'buyer_persona_defined',
    label: 'Buyer persona sketched (who decides, what triggers)',
    source: MARKET_1A_SOURCES.persona,
    track: '1A',
    evaluate: (s) => {
      // Market-research skill §5 (Customer Insights) produces this. Bilingual
      // (EN + IT). Bare 'persona' is deliberately absent — it is the Italian
      // word for "person" and would false-positive on nearly any IT fact;
      // the phrases below are the specific persona signals both SKILL files
      // instruct.
      const n = countMemoryFactsMatching(s, [
        'buyer persona', 'user persona', 'decision maker', 'purchase trigger', 'decision criteria',
        'chi decide', 'criteri di scelta', 'persona acquirente', 'profilo del cliente', 'trigger di acquisto',
      ]);
      return n > 0
        ? { passed: true, evidence: "You've sketched who buys and why." }
        : { passed: false, gap: 'Sketch the buyer persona — who decides and what triggers the purchase' };
    },
  },
  // NOTE (2026-07 founder decision): the old `monitors_set` ("L1 watchers
  // active") check was REMOVED from the gate. Watchers are now a POST-Stage-2
  // concern — the system auto-proposes them only once the Validation Gate is
  // COMPLETE (so the proposals are informed by the validated market/competitors
  // and are more accurate; see phase1-watchers.ts). Requiring an active watcher
  // to COMPLETE the gate contradicted that ("after Stage 2"), so it's gone. The
  // founder can still configure a watcher directly via chat at any time.
];

// ── Track 1B — Technical Validation ──────────────────────────────────────────
// These validate INCREMENTALLY as the chat advances: each reads memory_facts
// (founder-stated in chat, or written by the `technical-validation` skill),
// so the gate's technical track closes "man mano" — no single big run needed.
export const VALIDATION_TRACK_1B: StageCheck[] = [
  // 2026-07 alpha feedback: the old single `tech_feasibility` check swallowed
  // two distinct questions — HOW you'd build it and what could SINK it — so one
  // vague fact greened both. Split (ids retired: tech_feasibility). Both checks
  // keep the SAME source string (TECH_1B_SOURCES.feasibility): the
  // technical-validation skill's one feasibility card carries build approach
  // AND biggest risk by instruction, so its staged tech_fact legitimately
  // targets (and its keyword-bearing body closes) both.
  {
    id: 'build_approach',
    label: 'Build approach sketched (architecture / stack)',
    source: TECH_1B_SOURCES.feasibility,
    track: '1B',
    evaluate: (s) => {
      // Bilingual (EN + IT): founders chat in Italian, so the check must read
      // Italian facts too. IT terms use stems so the length-tuned
      // keywordMatcher catches inflections (fattibile/fattibilità).
      const n = countMemoryFactsMatching(s, [
        'feasibility', 'feasible', 'technically possible', 'build approach', 'architecture', 'tech stack',
        'fattibil', 'tecnicamente possibile', 'architettur', 'stack tecnico', 'come lo costruiamo',
      ]);
      return n > 0
        ? { passed: true, evidence: "You've sketched how the core approach would be built." }
        : { passed: false, gap: 'Sketch the build approach — architecture, stack (run Technical Validation or note it in chat)' };
    },
  },
  {
    id: 'technical_risk_named',
    label: 'Biggest technical risk named',
    source: TECH_1B_SOURCES.feasibility,
    track: '1B',
    evaluate: (s) => {
      // Bilingual (EN + IT). Multi-word phrases only — bare 'risk'/'rischio'
      // would match market/regulatory risk facts and cross-green this check.
      // The auto-stage fallback's feasibility prefix carries 'technical risk' /
      // 'rischio tecnico' verbatim so a real skill run always closes this.
      const n = countMemoryFactsMatching(s, [
        'technical risk', 'biggest risk', 'main risk', 'riskiest',
        'rischio tecnico', 'rischio principale', 'sfida tecnica',
      ]);
      return n > 0
        ? { passed: true, evidence: "You've named the single biggest technical risk." }
        : { passed: false, gap: 'Name the single biggest technical risk' };
    },
  },
  {
    id: 'key_dependencies',
    label: 'Key technical dependencies named',
    source: TECH_1B_SOURCES.dependencies,
    track: '1B',
    evaluate: (s) => {
      // Bilingual (EN + IT): "Dipendenze chiave", "si affida a", "terze parti".
      // 'dependenc' stem matches dependency AND dependencies (the plural never
      // matched before); 'dipendenz' stem matches dipendenza/dipendenze but NOT
      // "dipendenti" (employees — ends -t, not -z), so no false positive.
      const n = countMemoryFactsMatching(s, [
        'dependenc', 'depends on', 'third-party', 'integration', 'infrastructure', 'vendor', 'relies on',
        'dipendenz', 'dipende da', 'terze parti', 'integrazion', 'infrastruttur', 'fornitor', 'si affida', 'si basa su',
      ]);
      return n > 0
        ? { passed: true, evidence: "You've named the critical external dependencies." }
        : { passed: false, gap: 'Name the key dependencies (APIs, models, infra, vendors)' };
    },
  },
  {
    id: 'regulatory_check',
    label: 'Regulatory / compliance constraints checked',
    source: TECH_1B_SOURCES.regulatory,
    track: '1B',
    evaluate: (s) => {
      // Bilingual (EN + IT): "normativa", "conformità", "protezione dati".
      // 'compliance'/'GDPR'/'privacy' are used verbatim in Italian too.
      const n = countMemoryFactsMatching(s, [
        'regulation', 'regulatory', 'compliance', 'GDPR', 'license', 'certification', 'data protection', 'legal constraint',
        'normativ', 'regolament', 'conformità', 'conformita', 'licenza', 'licenze', 'certificazion', 'protezione dati', 'privacy', 'vincolo legale',
      ]);
      return n > 0
        ? { passed: true, evidence: "You've checked the regulatory/compliance constraints." }
        : { passed: false, gap: 'Check any regulatory/compliance constraints (e.g. GDPR, licensing)' };
    },
  },
];

/** Labels of the unmet 1A/1B checks. Empty ⇒ both tracks green ⇒ 1C unlocks. */
export function validationTracksABMissing(snapshot: ProjectSnapshot): string[] {
  return [...VALIDATION_TRACK_1A, ...VALIDATION_TRACK_1B]
    .filter((c) => !c.evaluate(snapshot).passed)
    .map((c) => c.label);
}

/** True when every 1A (Market) + 1B (Technical) check passes — the unlock
 *  condition for track 1C. Shared by the check lock wrapper, the 1C skill
 *  gate (skill-prereqs), and the chat route's proposal-time strip. */
export function validationTracksAB_done(snapshot: ProjectSnapshot): boolean {
  return validationTracksABMissing(snapshot).length === 0;
}

/** Lock wrapper for 1C checks: while 1A+1B have open gaps the check reports
 *  locked (never passed, never actionable) — the UI suppresses its CTA and
 *  the stage prompt tells the agent not to push interviews early. */
function lock1C(check: StageCheck): StageCheck {
  return {
    ...check,
    evaluate: (s) => {
      if (!validationTracksAB_done(s)) {
        return {
          passed: false,
          locked: true,
          gap: 'Locked — complete tracks 1A (Market) and 1B (Technical) first',
        };
      }
      return check.evaluate(s);
    },
  };
}

// ── Track 1C — Problem-Solution Fit (locked until 1A + 1B are green) ────────
const TRACK_1C_UNLOCKED: StageCheck[] = [
  {
    id: 'interviews_logged',
    label: '5+ customer interviews logged',
    source: 'interviews',
    track: '1C',
    evaluate: (s) => {
      // Deterministic row count from the structured interviews table.
      // Founder logs via chat (log_interview tool) or POST /api/.../interviews.
      const n = s.interviews.length;
      const ok = n >= 5;
      return ok
        ? { passed: true, evidence: `You've logged ${n} customer interviews.` }
        : { passed: false, gap: `${n} of 5 — tell the Co-pilot "I talked to X about Y" to log` };
    },
  },
  {
    id: 'pain_validated',
    label: 'Top pain point captured',
    source: 'interviews.top_pain + memory_facts',
    track: '1C',
    evaluate: (s) => {
      // Prefer structured: an interview row with a non-empty top_pain is
      // higher-signal than a memory_fact keyword match. Fall back to
      // memory_facts so the check still passes for historical projects
      // that captured pain before the interviews table existed.
      const withPain = s.interviews.filter((i) => i.top_pain && i.top_pain.trim().length > 5).length;
      if (withPain > 0) {
        return { passed: true, evidence: `${withPain} interview${withPain === 1 ? '' : 's'} captured the pain in the customer's own words.` };
      }
      // Bilingual (EN + IT). 'urgent' (leading-boundary) already catches IT
      // "urgente"; add the prose forms an Italian founder uses for the pain.
      const n = countMemoryFactsMatching(s, [
        'biggest pain', 'frustration', 'top problem', 'urgent',
        'frustrazion', 'problema principale', 'punto critico', 'punto dolente',
      ]);
      const ok = n > 0;
      return ok
        ? { passed: true, evidence: "You've captured the top pain customers feel." }
        : { passed: false, gap: 'Pin the single biggest pain in chat' };
    },
  },
  {
    id: 'wtp_signal',
    label: 'Willingness-to-pay signal captured',
    source: 'interviews.wtp_amount + pricing_state.wtp',
    track: '1C',
    evaluate: (s) => {
      // "Captured", not a conversion bar — the ≥30% WTP threshold is Loop-1
      // machinery, out of Phase-1 scope. One real data point closes this:
      // an interview with a WTP number, or a pricing_state.wtp entry.
      const withWtp = s.interviews.filter((i) => typeof i.wtp_amount === 'number' && i.wtp_amount > 0).length;
      if (withWtp > 0) {
        return { passed: true, evidence: `${withWtp} interview${withWtp === 1 ? '' : 's'} carried a willingness-to-pay amount.` };
      }
      const wtp = s.pricing_state?.wtp;
      const hasPricingWtp = !!wtp && typeof wtp === 'object' && Object.keys(wtp).length > 0;
      return hasPricingWtp
        ? { passed: true, evidence: 'Willingness-to-pay captured in your pricing data.' }
        : { passed: false, gap: 'Ask interviewees what they would pay — log it with the interview' };
    },
  },
];

export const VALIDATION_TRACK_1C: StageCheck[] = TRACK_1C_UNLOCKED.map(lock1C);

export const stageMarketValidation: Stage = {
  ...CANONICAL_BY_ID.market_validation,
  tagline: 'Validate market demand and technical feasibility before you build.',
  checks: [...VALIDATION_TRACK_1A, ...VALIDATION_TRACK_1B, ...VALIDATION_TRACK_1C],
};
