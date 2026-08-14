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

import type { Stage, StageCheck, CheckResult, ProjectSnapshot } from './types';
import { diffCanvas, type CanvasPayload, type VersionedCanvasField } from '@/lib/canvas-versions';
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
  // `risk` split out of `feasibility` (2026-08-05). build_approach and
  // technical_risk_named both pointed HERE while reading different keyword
  // families, so one staged item greened whichever family its wording happened
  // to hit — a gate walkthrough watched an IP finding green build_approach by
  // accident, and technical_risk_named was unclosable on purpose because the
  // staging hint could not name a call that targeted it alone.
  risk: 'memory_facts (technical risk)',
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

/** ip_analysis (Iteration Cycle 1B). Patents / trademarks / freedom-to-operate.
 *  'FTO' is ≤4 chars so keywordMatcher boundary-wraps it. */
export const IP_KEYWORDS = [
  'patent', 'trademark', 'freedom to operate', 'FTO', 'prior art', 'intellectual property',
  'brevett', 'marchio', 'marchi registrat', 'proprietà intellettuale', 'proprieta intellettuale', 'libertà operativa',
] as const;

/** data_availability (Iteration Cycle 1B) — "critico per prodotti AI/data-driven".
 *  Multi-word only: bare 'data'/'dati' would match nearly any fact. */
export const DATA_AVAILABILITY_KEYWORDS = [
  'data availability', 'training data', 'data quality', 'data source', 'dataset', 'data access',
  'disponibilità dei dati', 'disponibilita dei dati', 'qualità dei dati', 'qualita dei dati', 'fonte dei dati', 'accesso ai dati',
] as const;

/** validation_strategy (Iteration Cycle 1C) — how the founder intends to prove it. */
export const VALIDATION_STRATEGY_KEYWORDS = [
  'validation strategy', 'validation plan', 'how we will validate', 'how we validate', 'test plan',
  'strategia di validazione', 'piano di validazione', 'come validiamo', 'come validare',
] as const;

/** jtbd_mapping (Iteration Cycle 1C) — the JTBD frame behind the interviews. */
export const JTBD_KEYWORDS = [
  'jobs to be done', 'job to be done', 'jtbd', 'job story',
  'lavoro da svolgere', 'lavori da svolgere',
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
  // NOTE (Iteration Cycle alignment, 2026-08-04): `trends_assessed` and
  // `buyer_persona_defined` were REMOVED from the gate. The spec's 1A is
  // market SIZE / competitors / GTM / partners / regulatory — trends and buyer
  // persona are not gate evidence (Luca: "1A più o meno apposto, da rivedere un
  // paio di voci"). Their keyword families + fact kinds are kept: the facts are
  // still captured as knowledge, they simply no longer gate the stage.
  // `differentiation_evidence` moved to 1C, where the spec puts it
  // ("Differentiation evidenced -- vs competitive map di 1A").
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
    source: TECH_1B_SOURCES.risk,
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
  {
    // RESTORED to 1B (2026-08-04). I had moved this to 1A; the Iteration Cycle
    // spec wants regulatory in BOTH tracks at two DEPTHS — 1A carries a
    // "regulatory landscape overview (impatto macro su GTM)" and 1B the
    // "regulatory & compliance deep dive". Moving the deep dive out of 1B lost
    // it entirely. The 1A overview is NOT re-added as a second keyword check:
    // it would read the same keyword family, so one fact would green both and
    // the split would be theatre (the tech_feasibility lesson from #240).
    id: 'regulatory_check',
    label: 'Regulatory & compliance deep dive',
    source: TECH_1B_SOURCES.regulatory,
    track: '1B',
    evaluate: (s) => {
      const n = countMemoryFactsMatching(s, [...REGULATORY_KEYWORDS]);
      return n > 0
        ? { passed: true, evidence: "You've checked the regulatory/compliance landscape." }
        : { passed: false, gap: 'Check the regulatory landscape (e.g. GDPR, licensing, certification)' };
    },
  },

  {
    id: 'ip_analysis',
    label: 'IP analysis — patents, trademarks, freedom to operate',
    source: 'memory_facts (IP analysis)',
    track: '1B',
    evaluate: (s) => {
      const n = countMemoryFactsMatching(s, [...IP_KEYWORDS]);
      return n > 0
        ? { passed: true, evidence: "You've checked the IP landscape and your freedom to operate." }
        : { passed: false, gap: 'Check the IP landscape — patents, trademarks, freedom to operate in this domain' };
    },
  },
  {
    id: 'data_availability',
    label: 'Data availability & quality assessed',
    source: 'memory_facts (data availability)',
    track: '1B',
    evaluate: (s) => {
      const n = countMemoryFactsMatching(s, [...DATA_AVAILABILITY_KEYWORDS]);
      return n > 0
        ? { passed: true, evidence: "You've assessed what data you need and whether you can get it." }
        : { passed: false, gap: 'Assess data availability & quality — critical for AI/data-driven products' };
    },
  },
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
//
// Iteration Cycle 1C lists 11 steps. Implemented here are the ones with a real
// WRITE PATH (keyword family → chat sweep → item kind → executor prefix). The
// rest — cold users listed, interview/survey draft, cold users outreach,
// insight synthesis + evidence tagging, solution described in-depth, value
// proposition sharpened, startup scoring review — are ARTIFACTS, not facts:
// they need capture surfaces (a user list, a script document, a synthesis view)
// that do not exist yet. Adding them as keyword checks would create checks the
// founder cannot close, which is the exact bug class #251 warns about. Tracked
// separately rather than faked.
/** Exported for tests: the 1C checks WITHOUT the 1A+1B lock wrapper, so a
 *  single check's own logic can be exercised without staging the whole gate. */
export const TRACK_1C_UNLOCKED: StageCheck[] = [
  {
    id: 'validation_strategy',
    label: 'Validation strategy defined',
    source: 'memory_facts (validation strategy)',
    track: '1C',
    evaluate: (s) => {
      const n = countMemoryFactsMatching(s, [...VALIDATION_STRATEGY_KEYWORDS]);
      return n > 0
        ? { passed: true, evidence: "You've defined how you intend to validate this." }
        : { passed: false, gap: 'Define the validation strategy — what you will test, with whom, and what would prove it' };
    },
  },
  {
    id: 'jtbd_mapping',
    label: 'Jobs-to-be-Done mapped',
    source: 'memory_facts (JTBD)',
    track: '1C',
    evaluate: (s) => {
      const n = countMemoryFactsMatching(s, [...JTBD_KEYWORDS]);
      return n > 0
        ? { passed: true, evidence: "You've framed the job the customer is hiring you for." }
        : { passed: false, gap: 'Map the Jobs-to-be-Done — the frame that structures your interviews' };
    },
  },
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
    // MOVED from 1A (2026-08-04). Iteration Cycle 1C: "Differentiation
    // evidenced -- vs competitive map di 1A" — it is a PSF conclusion drawn
    // against the market map, not a market-desk step.
    id: 'differentiation_evidence',
    label: 'Differentiation evidenced',
    source: DIFFERENTIATION_CHECK_SOURCE,
    track: '1C',
    evaluate: (s) => {
      const n = countMemoryFactsMatching(s, [...DIFFERENTIATION_KEYWORDS]);
      return n > 0
        ? { passed: true, evidence: "You've evidenced how you're different from competitors." }
        : { passed: false, gap: 'Pin what makes you different, against the competitive map' };
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
  {
    // Iteration Cycle 1C: "Solution described in-depth — aggiornata sulla base
    // degli insight raccolti". The operative word is AGGIORNATA: a solution
    // written before the founder spoke to anyone is a hypothesis, not a 1C
    // output. So this measures a REVISION, not a word count.
    id: 'solution_in_depth',
    label: 'Solution updated on customer insights',
    source: 'idea_canvas.solution vs the pre-interview snapshot',
    track: '1C',
    evaluate: (s) => canvasFieldRevised(
      s, 'solution',
      'Your solution has been rewritten since you started talking to customers.',
      'Revise the solution with what the interviews taught you — it still reads as it did before them',
    ),
  },
  {
    // Iteration Cycle 1C: "Value proposition sharpened". Same instrument, same
    // reason — "sharpened" is a change relative to a before.
    id: 'value_prop_sharpened',
    label: 'Value proposition sharpened',
    source: 'idea_canvas.value_proposition vs the pre-interview snapshot',
    track: '1C',
    evaluate: (s) => canvasFieldRevised(
      s, 'value_proposition',
      'Your value proposition has been sharpened since the interviews began.',
      'Sharpen the value proposition against what you heard — it is unchanged since before the interviews',
    ),
  },
  {
    // Iteration Cycle 1C: "Startup Scoring review". The baseline score is a
    // Stage-1 check; this is the RE-score, the one that reflects real customer
    // evidence rather than the founder's own framing of their idea.
    //
    // score_history drops no-change appends, so a point recorded after the
    // first interview is a score that genuinely moved — not a re-run of the
    // same canvas returning the same number.
    id: 'scoring_review',
    label: 'Startup Scoring reviewed against the evidence',
    source: 'score_history (after the first interview)',
    track: '1C',
    evaluate: (s) => {
      const n = s.score_revisions_after_evidence;
      return n > 0
        ? { passed: true, evidence: `Your score has been re-run ${n === 1 ? 'once' : `${n} times`} since the interviews started.` }
        : { passed: false, gap: 'Re-run the Startup Scoring now that you have interview evidence — the baseline scored your assumptions' };
    },
  },
];

/**
 * Did a canvas field change since the pre-interview baseline?
 *
 * `diffCanvas` is the single definition of "changed" in this codebase —
 * whitespace-only edits and empty-vs-null don't count — and reusing it here
 * keeps the gate and the founder-facing v1/v2 diff from ever disagreeing about
 * whether something moved.
 *
 * No baseline means NOT COMPARABLE, never "unchanged". The baseline is written
 * on the first logged interview, and `interviews_logged` (5+) sits in the same
 * track, so by the time a founder is working on these two the "before" exists.
 */
function canvasFieldRevised(
  s: ProjectSnapshot,
  field: VersionedCanvasField,
  evidence: string,
  gap: string,
): CheckResult {
  const before = s.psf_baseline_canvas;
  if (!before) {
    return { passed: false, gap: 'Log your first interview first — the canvas is snapshotted then, so the update can be seen' };
  }
  const after = (s.idea_canvas ?? {}) as CanvasPayload;
  const changed = diffCanvas(before, after).some((c) => c.field === field);
  return changed ? { passed: true, evidence } : { passed: false, gap };
}

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
 * The verdict is GO / PIVOT / STOP — the SAME three words as the loop verdicts,
 * deliberately. A binary "no-go" hides two completely different decisions —
 * "this piece needs rework" and "this idea is dead" — and a system that cannot
 * tell them apart cannot respond correctly to either. Only GO passes; PIVOT and
 * STOP are recorded, explained, and reversible.
 */
const GATE_VERDICT_CHECK: StageCheck = {
  id: 'gate_verdict',
  label: 'Go / pivot / stop decision recorded',
  source: 'research.gate_verdict',
  track: '1C',
  evaluate: (s) => {
    const gv = s.research?.gate_verdict as { verdict?: unknown; scope?: unknown } | undefined;
    const verdict = gv && typeof gv === 'object' ? gv.verdict : undefined;
    if (verdict === 'GO') {
      return { passed: true, evidence: 'You reviewed the evidence and called GO on this gate.' };
    }
    if (verdict === 'PIVOT') {
      const scope = typeof gv?.scope === 'string' ? gv.scope : null;
      return {
        passed: false,
        gap: scope
          ? `You called PIVOT on track ${scope} — rework that evidence, then make the call again`
          : 'You called PIVOT — rework the weak evidence, then make the call again',
      };
    }
    if (verdict === 'STOP') {
      return { passed: false, gap: 'You called STOP on this idea — reopen the gate if you want to resume' };
    }
    return { passed: false, gap: 'Make the call — review the gate evidence and record GO, PIVOT or STOP' };
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
 * True when every gate EVIDENCE check passes — regardless of what the founder
 * has already decided.
 *
 * Split out from `shouldProposeGateVerdict` because the two questions are not
 * the same and conflating them cost the invariant. "Should we ASK?" is
 * evidence-complete AND undecided. "May a GO be RECORDED?" is evidence-complete,
 * full stop — an existing verdict must never be what unlocks it.
 */
export function validationGateEvidenceComplete(snapshot: ProjectSnapshot): boolean {
  if (!validationTracksAB_done(snapshot)) return false;
  return TRACK_1C_UNLOCKED.every((c) => c.evaluate(snapshot).passed);
}

/**
 * True when all gate EVIDENCE is in and only the founder's go/no-go is
 * outstanding — i.e. the moment to propose the verdict decision to them.
 * Mirrors `validationEvidenceDoneExceptWatchers`: a decision the founder is
 * never prompted for is a dead end.
 */
export function shouldProposeGateVerdict(snapshot: ProjectSnapshot): boolean {
  if (!validationGateEvidenceComplete(snapshot)) return false;
  const gv = snapshot.research?.gate_verdict as { verdict?: unknown } | undefined;
  const decided = gv && typeof gv === 'object'
    && (gv.verdict === 'GO' || gv.verdict === 'PIVOT' || gv.verdict === 'STOP');
  return !decided;
}

/** True when the founder's recorded verdict is GO. */
export function gateVerdictIsGo(snapshot: ProjectSnapshot): boolean {
  const gv = snapshot.research?.gate_verdict as { verdict?: unknown } | undefined;
  return !!gv && typeof gv === 'object' && gv.verdict === 'GO';
}

export const stageMarketValidation: Stage = {
  ...CANONICAL_BY_ID.market_validation,
  tagline: 'Validate market demand and technical feasibility before you build.',
  checks: [...VALIDATION_TRACK_1A, ...VALIDATION_TRACK_1B, ...VALIDATION_TRACK_1C],
};
