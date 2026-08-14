import { describe, it, expect } from 'vitest';
import { evaluateAllStages } from '@/lib/journey';
import { countGateEvidence } from './snapshot';
import { gateFactKindFor, gateFactPrefix, GATE_FACT_FAMILIES, GATE_FACT_PREFIXES } from '@/lib/gate-fact-families';
import { GATE_FACT_KINDS } from '@/lib/gate-fact-kinds';
import { keywordMatcher } from '@/lib/journey';
import { translate } from '@/lib/i18n/messages';
import type { ProjectSnapshot } from './types';

/**
 * Gate-fact ownership — a fact approved as family X greens X and nothing else.
 *
 * The defect these pin (measured on prod 2026-08-14): the apply path collapsed
 * all 13 approved item kinds into kind='observation' and re-encoded the family
 * as a text prefix, so every check re-derived meaning by keyword over the whole
 * corpus. 18 of 103 gate greens were false — 14 of them cross-family bleed:
 * an approved GTM fact whose prose mentioned partnerships also greened
 * partners_identified; an approved IP finding greened build_approach AND
 * regulatory_check. One project had 3 approved facts greening 6 checks.
 */

type Fact = { id: string; content: string; source_type: string | null; kind: string };

function snap(facts: Fact[]): ProjectSnapshot {
  return {
    idea_canvas: null, competitors: [], research: null, monitors: [], watch_sources: [],
    pricing_state: null, burn_rate: null, workflow: null, growth_loops: [], metrics: [],
    memory_facts: facts as ProjectSnapshot['memory_facts'],
    interviews: [], fundraising_round: null, investors: [],
    counts: { published_assets: 0, pending_actions: 0, knowledge_items: 0 },
    startup_score: null, psf_baseline_canvas: null, score_revisions_after_evidence: 0,
  };
}
const fact = (content: string, kind: string, source_type: string | null = null): Fact =>
  ({ id: `f-${kind}-${content.slice(0, 8)}`, content, source_type, kind });

const gateCheck = (s: ProjectSnapshot, id: string) =>
  evaluateAllStages(s).find((e) => e.stage.id === 'market_validation')!
    .results.find((r) => r.check.id === id)!.result;

describe('an approved fact greens ONLY the family it was approved as', () => {
  it('a GTM fact that talks about partnerships no longer greens partners_identified', () => {
    // Real prod row (proj_f74c7d59-956): approved as GTM evidence, greened both.
    const s = snap([fact(
      'Opportunità GTM — Canale istituzionale: FNOFI (75.000 iscritti, 38 ordini) e AIFI sono partner possibili.',
      'gtm_fact',
    )]);
    expect(gateCheck(s, 'gtm_opportunities').passed).toBe(true);
    expect(gateCheck(s, 'partners_identified').passed).toBe(false);
  });

  it('an approved IP finding no longer greens build_approach or regulatory_check', () => {
    // Real prod rows (proj_739ff378-3d5, proj_13f32703-c4f).
    const s = snap([fact(
      'Proprietà intellettuale — MediaPipe (Google) è rilasciato sotto licenza Apache 2.0 — uso commerciale libero.',
      'ip_fact',
    )]);
    expect(gateCheck(s, 'ip_analysis').passed).toBe(true);
    expect(gateCheck(s, 'build_approach').passed).toBe(false);
    expect(gateCheck(s, 'regulatory_check').passed).toBe(false);
  });

  it('a partner fact no longer greens key_dependencies', () => {
    const s = snap([fact(
      'Partner potenziale — Gestionali IT (FisioDesk 1.000+ utenti) dipendono da integrazioni di terze parti.',
      'partner_fact',
    )]);
    expect(gateCheck(s, 'partners_identified').passed).toBe(true);
    expect(gateCheck(s, 'key_dependencies').passed).toBe(false);
  });

  it('but the technical-validation feasibility card still closes BOTH 1B checks it carries', () => {
    // Deliberate, not bleed: auto-stage-validation stages ONE card labelled
    // "Technical feasibility & main technical risk" that contains both findings.
    const s = snap([fact(
      'Fattibilità tecnica — architettura a microservizi; il rischio tecnico principale è la latenza on-device.',
      'tech_feasibility_fact',
    )]);
    expect(gateCheck(s, 'build_approach').passed).toBe(true);
    expect(gateCheck(s, 'technical_risk_named').passed).toBe(true);
  });
});

describe('legacy free text still counts, and says so', () => {
  it('an unclassified founder statement greens its check but is marked `stated`', () => {
    // Luca's DeskMate row: a July answer about WHO FEELS THE PAIN that happened
    // to contain "rischi di compliance", read by the gate as a regulatory
    // deep dive. Revoking it would un-do real work; overstating it is the bug.
    const s = snap([fact(
      'Per imprese più piccole è il titolare a percepire il problema: perdite di tempo e rischi di compliance.',
      'observation',
    )]);
    const r = gateCheck(s, 'regulatory_check');
    expect(r.passed).toBe(true);
    expect(r.stated).toBe(true);
  });

  it('an APPROVED fact is not marked `stated`', () => {
    const s = snap([fact('Normativa — GDPR art. 9, dati sanitari: serve DPO.', 'regulatory_fact')]);
    const r = gateCheck(s, 'regulatory_check');
    expect(r.passed).toBe(true);
    expect(r.stated).toBeFalsy();
  });
});

describe('agent-authored breadcrumbs are never founder evidence', () => {
  it('a pre-2026-07-11 workflow trace (source_type=chat) no longer greens gtm_opportunities', () => {
    // 48 such rows on prod, written 05-11 → 06-22, before workflow-capture
    // started tagging source_type='workflow'. Migration 040 re-sources them;
    // this belt covers staging, which has no migration ledger at all.
    const s = snap([fact(
      'Agent proposed workflow "90-Day GTM Plan — Indie SaaS Email Triage" (8 steps, category: marketing)',
      'decision', 'chat',
    )]);
    expect(gateCheck(s, 'gtm_opportunities').passed).toBe(false);
  });
});

describe('the family ↔ fact-kind ↔ prefix chain is complete', () => {
  it('every family resolves to a fact kind', () => {
    for (const fam of GATE_FACT_FAMILIES) {
      const resolved = gateFactKindFor(fam.kind, fam.field);
      expect(resolved, `${fam.kind}:${fam.field ?? ''}`).toBe(fam.factKind);
    }
  });

  it('every fact kind has a prefix in both locales, inside its own keyword family', () => {
    for (const k of GATE_FACT_KINDS) {
      expect(GATE_FACT_PREFIXES[k], k).toBeDefined();
      // Where a family owns this kind, the prefix must still keyword-match it:
      // pre-migration facts are found by the legacy branch, which reads text.
      const fam = GATE_FACT_FAMILIES.find((f) => f.factKind === k);
      if (!fam) continue;
      for (const locale of ['en', 'it'] as const) {
        const prefix = gateFactPrefix(k, locale);
        expect(keywordMatcher([...fam.keywords]).test(prefix), `${k}/${locale}: "${prefix}"`).toBe(true);
      }
    }
  });

  it('the market-size Apply prefix agrees with the shared table (two writers, one string)', () => {
    // action-executors' market_size_fact branch prefixes from the i18n key
    // `avs.prefix-market-size` while every other family reads GATE_FACT_PREFIXES.
    // Two sources for one string is how they drift; pin them equal.
    expect(translate('en', 'avs.prefix-market-size')).toBe(gateFactPrefix('market_size_fact', 'en'));
    expect(translate('it', 'avs.prefix-market-size')).toBe(gateFactPrefix('market_size_fact', 'it'));
  });

  it('countGateEvidence reports approval, not just a count', () => {
    const both = snap([
      fact('Normativa — GDPR art. 9.', 'regulatory_fact'),
      fact('Parliamo di privacy e compliance.', 'observation'),
    ]);
    const r = countGateEvidence(both, ['GDPR', 'compliance', 'privacy'], ['regulatory_fact']);
    expect(r.count).toBe(2);
    expect(r.approved).toBe(true);
  });
});
