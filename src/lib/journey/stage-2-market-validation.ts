/**
 * Stage 2 — Market Validation.
 * Evidence that the problem is real, painful, and frequent enough that
 * someone would pay to solve it — and that you can name why you win.
 * Canvas alone doesn't cut it: you need competitors mapped (proves a market
 * exists), customer evidence (proves the pain), and differentiation backed
 * by evidence, not vibes.
 *
 * Re-bucketing note (2026-06 taxonomy unification): absorbs all of legacy
 * "Problem" plus legacy "Solution"'s differentiation_evidence (it reads
 * market facts, so it belongs with market validation). Check ids and
 * evaluator logic are unchanged, with ONE functional fix: `monitors_set`
 * now counts active watch_sources (URL watchers) alongside monitors —
 * both are founder-facing "watchers" and either closes the gate.
 */

import type { Stage } from './types';
import { CANONICAL_BY_ID } from './canonical';
import { countMemoryFactsMatching } from './snapshot';

export const stageMarketValidation: Stage = {
  ...CANONICAL_BY_ID.market_validation,
  tagline: 'Validate market demand and technical feasibility before you build.',
  checks: [
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
      source: 'memory_facts (market sizing)',
      track: '1A',
      evaluate: (s) => {
        // Bilingual (EN + IT): TAM/SAM/SOM are universal; "dimensione del mercato",
        // "mercato indirizzabile" are how an Italian founder states it in prose.
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
      id: 'interviews_logged',
      label: '5+ customer interviews logged',
      source: 'interviews',
      track: '1A',
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
      track: '1A',
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
      id: 'monitors_set',
      label: 'Watchers active',
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
          ? { passed: true, evidence: `You have ${active} watcher${active === 1 ? '' : 's'} tracking this market.` }
          : { passed: false, gap: 'Set at least one watcher on competitors or trends' };
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
        // differenziazione; "a differenza di" / "ci distinguiamo" are the IT prose forms.
        const n = countMemoryFactsMatching(s, [
          'unlike', 'better than', 'differentiator', 'compared to',
          'a differenza di', 'differenz', 'meglio di', 'ci distinguiamo',
        ]);
        const ok = n > 0;
        return ok
          ? { passed: true, evidence: "You've evidenced how you're different from competitors." }
          : { passed: false, gap: 'Pin what makes you different in chat' };
      },
    },
    // ── L2 Validation Gate · track 1B (Technical Validation) ──────────────────
    // These validate INCREMENTALLY as the chat advances: each reads memory_facts
    // (founder-stated in chat, or written by the `technical-validation` skill),
    // so the gate's technical track closes "man mano" — no single big run needed.
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
        // 'dipendenz' stem matches dipendenza/dipendenze but NOT "dipendenti"
        // (employees — ends -t, not -z), so no false positive.
        const n = countMemoryFactsMatching(s, [
          'dependency', 'depends on', 'third-party', 'integration', 'infrastructure', 'vendor', 'relies on',
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
  ],
};
