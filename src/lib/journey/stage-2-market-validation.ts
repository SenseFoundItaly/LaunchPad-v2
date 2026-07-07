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
export const VALIDATION_TRACK_1A: StageCheck[] = [
  {
    id: 'problem_defined',
    label: 'Problem clearly defined',
    source: 'idea_canvas.problem',
    track: '1A',
    evaluate: (s) => {
      const p = s.idea_canvas?.problem?.trim() ?? '';
      const ok = p.length >= 40;
      return ok
        ? { passed: true, evidence: 'Your problem statement is specific and well-formed.' }
        : { passed: false, gap: 'Sharpen the problem to at least 40 chars' };
    },
  },
  {
    id: 'segment_named',
    label: 'Target segment named',
    source: 'idea_canvas.target_market',
    track: '1A',
    evaluate: (s) => {
      const ok = !!s.idea_canvas?.target_market?.trim();
      return ok
        ? { passed: true, evidence: "You've named the customer segment you're targeting." }
        : { passed: false, gap: 'Name a specific customer segment' };
    },
  },
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
      const n = countMemoryFactsMatching(s, [
        'market size', 'TAM', 'SAM', 'SOM', 'addressable',
        'dimensione del mercato', 'dimensione di mercato', 'mercato totale', 'mercato indirizzabile',
      ]);
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
    id: 'monitors_set',
    label: 'L1 watchers active',
    source: 'monitors + watch_sources',
    track: '1A',
    evaluate: (s) => {
      // ANY active signal-watching counts: topic monitors AND URL watchers
      // (watch_sources). Both are "watchers" to the founder — a project
      // with only URL watchers was wrongly failing this gate before.
      const activeMonitors = s.monitors.filter((m) => m.status === 'active').length;
      const activeWatchSources = s.watch_sources.filter((w) => w.status === 'active').length;
      const active = activeMonitors + activeWatchSources;
      const ok = active >= 1;
      return ok
        ? { passed: true, evidence: `You have ${active} L1 watcher${active === 1 ? '' : 's'} tracking this market.` }
        : { passed: false, gap: 'Activate at least one L1 watcher on competitors or trends' };
    },
  },
];

// ── Track 1B — Technical Validation ──────────────────────────────────────────
// These validate INCREMENTALLY as the chat advances: each reads memory_facts
// (founder-stated in chat, or written by the `technical-validation` skill),
// so the gate's technical track closes "man mano" — no single big run needed.
export const VALIDATION_TRACK_1B: StageCheck[] = [
  {
    id: 'tech_feasibility',
    label: 'Technical feasibility assessed',
    source: 'memory_facts (feasibility)',
    track: '1B',
    evaluate: (s) => {
      // Bilingual (EN + IT): founders chat in Italian, so the check must read
      // Italian facts too — "Rischio tecnico", "Stack tecnico", "fattibilità"
      // would otherwise never close the gate. IT terms use stems so the
      // length-tuned keywordMatcher catches inflections (fattibile/fattibilità).
      const n = countMemoryFactsMatching(s, [
        'feasibility', 'feasible', 'technically possible', 'build approach', 'architecture', 'tech stack', 'technical risk',
        'fattibil', 'tecnicamente possibile', 'architettur', 'stack tecnico', 'rischio tecnico', 'sfida tecnica',
      ]);
      return n > 0
        ? { passed: true, evidence: "You've assessed whether the core approach is buildable." }
        : { passed: false, gap: 'Assess technical feasibility (run Technical Validation or note it in chat)' };
    },
  },
  {
    id: 'key_dependencies',
    label: 'Key technical dependencies named',
    source: 'memory_facts (dependencies)',
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
    source: 'memory_facts (regulatory)',
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
