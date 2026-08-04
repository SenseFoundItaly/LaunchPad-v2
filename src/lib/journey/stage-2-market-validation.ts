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
  gtm: 'memory_facts (GTM opportunities)',
  partners: 'memory_facts (potential partners)',
} as const;

/** The differentiation check's `source` string — exported so the
 *  `differentiation_fact` item kind (chat retro-sweep) maps drift-proof. */
export const DIFFERENTIATION_CHECK_SOURCE = 'memory_facts (vs. competitors)';

// ── Exported keyword lists ───────────────────────────────────────────────────
// One named constant per keyword-matched check, used BOTH by the check's
// evaluate and by the chat retro-sweep (chat-fact-sweep.ts) — the same
// import-never-retype discipline as MARKET_SIZE_KEYWORDS, so the sweep can
// never green-light a phrasing the check wouldn't count (or vice versa).

/** differentiation_evidence. 'vs' removed — bare substring matched any
 *  comparison. 'differenz' stem catches differenza/differenziamo/-azione. */
export const DIFFERENTIATION_KEYWORDS = [
  'unlike', 'better than', 'differentiator', 'compared to',
  'a differenza di', 'differenz', 'meglio di', 'ci distinguiamo', 'rispetto a',
] as const;

/** trends_assessed. Bare 'trend' deliberately absent (matches almost any
 *  metric sentence); 'tendenz' stem catches tendenza/tendenze. */
export const TRENDS_KEYWORDS = [
  'tailwind', 'headwind', 'market trend', 'market shift', 'growth rate',
  'trend di mercato', 'tendenz', 'vento a favore', 'vento contrario', 'in crescita', 'in calo',
] as const;

/** buyer_persona_defined. Bare 'persona' deliberately absent — it is the
 *  Italian word for "person" and would false-positive on nearly any IT fact. */
export const BUYER_PERSONA_KEYWORDS = [
  'buyer persona', 'user persona', 'decision maker', 'purchase trigger', 'decision criteria',
  'chi decide', 'criteri di scelta', 'persona acquirente', 'profilo del cliente', 'trigger di acquisto',
] as const;

/** build_approach. IT stems (fattibil/architettur) catch inflections. */
export const BUILD_APPROACH_KEYWORDS = [
  'feasibility', 'feasible', 'technically possible', 'build approach', 'architecture', 'tech stack',
  'fattibil', 'tecnicamente possibile', 'architettur', 'stack tecnico', 'come lo costruiamo',
] as const;

/** technical_risk_named. Multi-word phrases only — bare 'risk'/'rischio'
 *  would match market/regulatory risk facts and cross-green the check. */
export const TECH_RISK_KEYWORDS = [
  'technical risk', 'biggest risk', 'main risk', 'riskiest',
  'rischio tecnico', 'rischio principale', 'sfida tecnica',
] as const;

/** key_dependencies. 'dependenc'/'dipendenz' stems: plural-safe, and
 *  'dipendenz' does NOT match "dipendenti" (employees — ends -t, not -z). */
export const DEPENDENCY_KEYWORDS = [
  'dependenc', 'depends on', 'third-party', 'integration', 'infrastructure', 'vendor', 'relies on',
  'dipendenz', 'dipende da', 'terze parti', 'integrazion', 'infrastruttur', 'fornitor', 'si affida', 'si basa su',
] as const;

/** gtm_opportunities (founder request 2026-08-04). 'gtm' is ≤4 chars so
 *  keywordMatcher wraps it in a trailing \b — it matches the acronym, never a
 *  longer word. The executor's Apply prefixes ("GTM opportunity — " /
 *  "Opportunità GTM — ") both contain 'gtm' verbatim, so an applied item always
 *  greens the check regardless of the founder's phrasing. */
export const GTM_KEYWORDS = [
  'gtm', 'go-to-market', 'go to market', 'launch channel', 'acquisition strategy', 'route to market',
  'canale di lancio', 'strategia di acquisizione', 'come arriviamo al cliente', 'sfida di lancio',
] as const;

/** partners_identified (founder request 2026-08-04). 'partner' is the same word
 *  in EN and IT and >4 chars, so the stem covers partner/partners/partnership/
 *  partnership commerciale. Apply prefixes ("Potential partner — " / "Partner
 *  potenziale — ") carry it verbatim. */
export const PARTNERS_KEYWORDS = [
  'partner', 'partnership', 'reseller', 'distributor', 'channel partner', 'strategic alliance',
  'rivenditor', 'distributor', 'alleanza strategica', 'accordo commerciale', 'intesa con',
] as const;

/** regulatory_check. 'compliance'/'GDPR'/'privacy' are verbatim in Italian too. */
export const REGULATORY_KEYWORDS = [
  'regulation', 'regulatory', 'compliance', 'GDPR', 'license', 'certification', 'data protection', 'legal constraint',
  'normativ', 'regolament', 'conformità', 'conformita', 'licenza', 'licenze', 'certificazion', 'protezione dati', 'privacy', 'vincolo legale',
] as const;

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
  // Order is display order. market_size leads (founder request 2026-08-04):
  // you size the space BEFORE you enumerate who is in it — mapping competitors
  // first invites a list with no denominator.
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
    id: 'differentiation_evidence',
    label: 'Differentiation evidenced',
    source: DIFFERENTIATION_CHECK_SOURCE,
    track: '1A',
    evaluate: (s) => {
      // "a differenza di" / "ci distinguiamo" / "rispetto a" are the IT prose
      // forms (all three phrasings SKILL.it.md instructs).
      const n = countMemoryFactsMatching(s, [...DIFFERENTIATION_KEYWORDS]);
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
      // content — its staged trend_fact items, once applied, close the check.
      // Like the rest of the keyword checks these auto-apply from chat — the
      // founder stated the fact, which is the founder yes (only market SIZING
      // is spine-moving-gated, see MARKET_SIZE_KEYWORDS).
      const n = countMemoryFactsMatching(s, [...TRENDS_KEYWORDS]);
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
      // Market-research skill §5 (Customer Insights) produces this — staged
      // as a buyer_persona_fact item; the phrases in the list are the specific
      // persona signals both SKILL files instruct.
      const n = countMemoryFactsMatching(s, [...BUYER_PERSONA_KEYWORDS]);
      return n > 0
        ? { passed: true, evidence: "You've sketched who buys and why." }
        : { passed: false, gap: 'Sketch the buyer persona — who decides and what triggers the purchase' };
    },
  },
  // ── Founder-requested additions, 2026-08-04 ────────────────────────────────
  // Same lockstep discipline as trends/persona: keyword family + a chat-sweep
  // family + an executor Apply prefix that is itself verbatim in the list, so
  // the check is always CLOSEABLE. A check with no write path is permanently
  // red — that is the bug class #251 warns about.
  {
    id: 'gtm_opportunities',
    label: 'GTM chances & challenges assessed',
    source: MARKET_1A_SOURCES.gtm,
    track: '1A',
    evaluate: (s) => {
      const n = countMemoryFactsMatching(s, [...GTM_KEYWORDS]);
      return n > 0
        ? { passed: true, evidence: "You've assessed how you'd reach this market — the opening and the friction." }
        : { passed: false, gap: 'Assess the go-to-market — where the opening is and what will fight you' };
    },
  },
  {
    id: 'partners_identified',
    label: 'Potential partners detected',
    source: MARKET_1A_SOURCES.partners,
    track: '1A',
    evaluate: (s) => {
      const n = countMemoryFactsMatching(s, [...PARTNERS_KEYWORDS]);
      return n > 0
        ? { passed: true, evidence: "You've identified who could carry you into this market." }
        : { passed: false, gap: 'Name the potential partners, resellers or distributors worth approaching' };
    },
  },
  {
    // MOVED from track 1B (founder request 2026-08-04): the founder reads this
    // as market LANDSCAPE, not as a technical constraint, and could not find it
    // under Tecnica. Source string keeps its TECH_1B_SOURCES home so the
    // `tech_fact(regulatory)` item mapping in validation-targets stays
    // drift-proof — only the track and the label move. The 1A+1B UNION is
    // unchanged, so this move re-locks nothing.
    id: 'regulatory_check',
    label: 'Regulatory landscape checked',
    source: TECH_1B_SOURCES.regulatory,
    track: '1A',
    evaluate: (s) => {
      const n = countMemoryFactsMatching(s, [...REGULATORY_KEYWORDS]);
      return n > 0
        ? { passed: true, evidence: "You've checked the regulatory/compliance landscape." }
        : { passed: false, gap: 'Check the regulatory landscape (e.g. GDPR, licensing, certification)' };
    },
  },
  {
    // RE-ADDED 2026-08-04 at founder request ("watcher attivati"), after being
    // removed in 2026-07 for circularity: watchers were proposed only once the
    // WHOLE gate completed, so requiring one to complete the gate deadlocked.
    //
    // The circularity is broken in phase1-watchers.ts, not here: the proposer
    // now fires as soon as every OTHER 1A/1B check is green (see
    // `shouldProposePhase1Watchers`), which is the moment the market and
    // technical evidence is in and the auto-proposed watchers are accurate.
    // So the founder always gets proposals BEFORE this check is the last one
    // standing. `monitors_set` must be the ONLY check excluded from that
    // predicate — see WATCHER_EXCLUDED_CHECK_ID.
    id: 'monitors_set',
    label: 'Signal watchers active',
    source: 'monitors + watch_sources',
    track: '1A',
    evaluate: (s) => {
      const n =
        s.monitors.filter((m) => m.status === 'active').length +
        s.watch_sources.filter((w) => w.status === 'active').length;
      return n > 0
        ? { passed: true, evidence: `You have ${n} active watcher${n === 1 ? '' : 's'} on this market.` }
        : { passed: false, gap: 'Activate a watcher — apply one of the proposals in your inbox' };
    },
  },
  // NOTE (2026-07): this is where the ORIGINAL `monitors_set` was removed. See
  // the re-added check directly above. Watchers are now a POST-Stage-2
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
      // Italian facts too.
      const n = countMemoryFactsMatching(s, [...BUILD_APPROACH_KEYWORDS]);
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
      // The auto-stage fallback's feasibility prefix carries 'technical risk' /
      // 'rischio tecnico' verbatim so a real skill run always closes this.
      const n = countMemoryFactsMatching(s, [...TECH_RISK_KEYWORDS]);
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
      const n = countMemoryFactsMatching(s, [...DEPENDENCY_KEYWORDS]);
      return n > 0
        ? { passed: true, evidence: "You've named the critical external dependencies." }
        : { passed: false, gap: 'Name the key dependencies (APIs, models, infra, vendors)' };
    },
  },
  // `regulatory_check` used to live here — moved to track 1A (2026-08-04), see
  // the note on its new definition. 1B is now purely "can we build it".
];

/** Labels of the unmet 1A/1B checks. Empty ⇒ both tracks green ⇒ 1C unlocks. */
export function validationTracksABMissing(snapshot: ProjectSnapshot): string[] {
  return [...VALIDATION_TRACK_1A, ...VALIDATION_TRACK_1B]
    .filter((c) => !c.evaluate(snapshot).passed)
    .map((c) => c.label);
}

/** The one check the watcher proposer must ignore, or it can never fire.
 *  Exported so the exclusion is named in ONE place and testable. */
export const WATCHER_EXCLUDED_CHECK_ID = 'monitors_set';

/**
 * True when every 1A + 1B check EXCEPT `monitors_set` passes — the moment the
 * market and technical evidence is complete and auto-proposed watchers would
 * be accurate.
 *
 * This exists to break the deadlock that got `monitors_set` deleted in 2026-07:
 * the gate needs an active watcher, and watchers were only proposed once the
 * gate was done. Triggering the proposer HERE means the founder is handed
 * watcher proposals exactly when `monitors_set` becomes the last open check.
 */
export function validationEvidenceDoneExceptWatchers(snapshot: ProjectSnapshot): boolean {
  return [...VALIDATION_TRACK_1A, ...VALIDATION_TRACK_1B]
    .filter((c) => c.id !== WATCHER_EXCLUDED_CHECK_ID)
    .every((c) => c.evaluate(snapshot).passed);
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

/**
 * The founder's explicit GO on the whole gate (founder request 2026-08-04:
 * "verdict go/no go"). This is deliberately NOT an evidence check — every
 * other check measures the world; this one records a DECISION.
 *
 * Two properties that matter:
 *  - It is the LAST thing to open. Locked until every other gate check passes,
 *    so a founder can never GO past evidence they haven't gathered.
 *  - It is founder-attested, never inferred. `research.gate_verdict` is
 *    stamped only by an Apply on a founder-approved proposal (migration 037) —
 *    same discipline as `research.market_size.approved`. An AI-computed
 *    readiness verdict already exists (stage-readiness.ts, 0-10 STRONG GO /
 *    GO / CAUTION / NOT READY); it informs this decision and must never
 *    replace it.
 *
 * NO_GO is recorded but does NOT pass: a founder who decides not to proceed
 * has answered the question honestly, and the gate stays open rather than
 * greening a stage they just rejected.
 */
const GATE_VERDICT_CHECK: StageCheck = {
  id: 'gate_verdict',
  label: 'Go / no-go decision recorded',
  source: 'research.gate_verdict',
  track: '1C',
  evaluate: (s) => {
    const gv = s.research?.gate_verdict as { verdict?: unknown; motivation?: unknown } | undefined;
    const verdict = gv && typeof gv === 'object' ? gv.verdict : undefined;
    if (verdict === 'GO') {
      return { passed: true, evidence: 'You reviewed the evidence and called GO on this gate.' };
    }
    if (verdict === 'NO_GO') {
      return { passed: false, gap: 'You called NO-GO — revisit the evidence or pivot before proceeding' };
    }
    return { passed: false, gap: 'Make the call — review the gate evidence and record GO or NO-GO' };
  },
};

/** Lock wrapper for the verdict: it opens only once EVERY other gate check
 *  (1A, 1B and the three 1C evidence checks) has passed. */
function lockVerdict(check: StageCheck): StageCheck {
  return {
    ...check,
    evaluate: (s) => {
      const evidenceOpen =
        !validationTracksAB_done(s) || TRACK_1C_UNLOCKED.some((c) => !c.evaluate(s).passed);
      if (evidenceOpen) {
        return {
          passed: false,
          locked: true,
          gap: 'Locked — gather every piece of gate evidence first, then make the call',
        };
      }
      return check.evaluate(s);
    },
  };
}

export const VALIDATION_TRACK_1C: StageCheck[] = [
  ...TRACK_1C_UNLOCKED.map(lock1C),
  lockVerdict(GATE_VERDICT_CHECK),
];

/**
 * True when all gate EVIDENCE is in and only the founder's go/no-go is
 * outstanding — i.e. the moment to propose the verdict decision to them.
 * Mirrors `validationEvidenceDoneExceptWatchers`: a decision the founder is
 * never prompted for is a dead end.
 */
export function shouldProposeGateVerdict(snapshot: ProjectSnapshot): boolean {
  if (!validationTracksAB_done(snapshot)) return false;
  if (TRACK_1C_UNLOCKED.some((c) => !c.evaluate(snapshot).passed)) return false;
  const gv = snapshot.research?.gate_verdict as { verdict?: unknown } | undefined;
  return !(gv && typeof gv === 'object' && (gv.verdict === 'GO' || gv.verdict === 'NO_GO'));
}

export const stageMarketValidation: Stage = {
  ...CANONICAL_BY_ID.market_validation,
  tagline: 'Validate market demand and technical feasibility before you build.',
  checks: [...VALIDATION_TRACK_1A, ...VALIDATION_TRACK_1B, ...VALIDATION_TRACK_1C],
};
