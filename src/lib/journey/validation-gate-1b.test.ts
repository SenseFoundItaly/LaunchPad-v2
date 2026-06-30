import { describe, it, expect } from 'vitest';
import { evaluateAllStages, keywordMatcher } from '@/lib/journey';
import type { ProjectSnapshot } from '@/lib/journey/types';

/**
 * L2 Validation Gate · track 1B (Technical Validation) — integration test.
 *
 * Exercises the REAL evaluateAllStages over the validation stage so we prove the
 * "validate man mano" chain end-to-end: applied chat memory_facts (what the chat
 * co-pilot's save_memory_fact writes, or what the technical-validation skill's
 * insight-cards become once applied) flip the 1B checks green incrementally.
 */

function mkSnapshot(
  facts: Array<{ content: string; source_type?: string; kind?: string }>,
): ProjectSnapshot {
  return {
    idea_canvas: null,
    competitors: [],
    research: null,
    monitors: [],
    watch_sources: [],
    pricing_state: null,
    burn_rate: null,
    workflow: null,
    growth_loops: [],
    metrics: [],
    memory_facts: facts.map((f, i) => ({
      id: `f${i}`,
      content: f.content,
      source_type: f.source_type ?? 'chat',
      kind: f.kind ?? 'observation',
    })),
    interviews: [],
    fundraising_round: null,
    investors: [],
    counts: { published_assets: 0, pending_actions: 0, knowledge_items: 0 },
  };
}

/** The validation-gate (stage 2) checks, keyed by id → passed. */
function gateChecks(snapshot: ProjectSnapshot): Record<string, boolean> {
  const evals = evaluateAllStages(snapshot);
  const gate = evals.find((e) => e.stage.id === 'market_validation');
  if (!gate) throw new Error('validation stage not found');
  const byId: Record<string, boolean> = {};
  for (const r of gate.results) byId[r.check.id] = r.result.passed;
  return byId;
}

describe('L2 Validation Gate · 1B Technical (incremental)', () => {
  it('the 3 track-1B checks exist on the validation stage and are tagged 1B', () => {
    const gate = evaluateAllStages(mkSnapshot([])).find((e) => e.stage.id === 'market_validation')!;
    const oneB = gate.stage.checks.filter((c) => c.track === '1B').map((c) => c.id);
    expect(oneB).toEqual(['tech_feasibility', 'key_dependencies', 'regulatory_check']);
  });

  it('1B checks are RED with no technical evidence', () => {
    const c = gateChecks(mkSnapshot([]));
    expect(c.tech_feasibility).toBe(false);
    expect(c.key_dependencies).toBe(false);
    expect(c.regulatory_check).toBe(false);
  });

  it('1B checks go GREEN as applied facts accrue (man mano)', () => {
    const c = gateChecks(mkSnapshot([
      { content: 'Technical feasibility: the matching engine is feasible with a vector DB; main technical risk is latency at scale.' },
      { content: 'Key dependency: relies on the Stripe API for billing and OpenAI for embeddings.' },
      { content: 'Regulatory: handling EU user data means GDPR applies; needs a DPA with vendors.' },
    ]));
    expect(c.tech_feasibility).toBe(true);
    expect(c.key_dependencies).toBe(true);
    expect(c.regulatory_check).toBe(true);
  });

  it('1B checks close on ITALIAN facts (bilingual founders)', () => {
    // Real text the chat agent persisted for an Italian founder (proj_9f77e3a5).
    const c = gateChecks(mkSnapshot([
      { content: 'Rischio tecnico principale: mantenere i dati dei bandi aggiornati su decine di portali regionali italiani.' },
      { content: 'Dipendenze chiave: feed dei portali bandi regionali italiani e OpenAI API per il matching.' },
      { content: 'Compliance: processa dati di PMI italiane → obbligo GDPR e protezione dati.' },
    ]));
    expect(c.tech_feasibility).toBe(true);
    expect(c.key_dependencies).toBe(true);
    expect(c.regulatory_check).toBe(true);
  });

  it('the IT dependency stem does NOT match "dipendenti" (employees)', () => {
    const c = gateChecks(mkSnapshot([
      { content: 'Abbiamo 10 dipendenti a tempo pieno nel team.' },
    ]));
    expect(c.key_dependencies).toBe(false);
  });

  it('they validate INDEPENDENTLY (only the matched track closes)', () => {
    const c = gateChecks(mkSnapshot([
      { content: 'Key dependency: relies on a third-party payments vendor.' },
    ]));
    expect(c.key_dependencies).toBe(true);
    expect(c.tech_feasibility).toBe(false);
    expect(c.regulatory_check).toBe(false);
  });

  it('an Italian regulatory fact closes regulatory_check WITHOUT false-closing market_size', () => {
    // Regression for the bilingual substring bug: the founder's GDPR fact reads
    // "trattamento dati …" — Italian "trattamento" (= processing) contains the
    // substring "tam". The old bare-substring matcher (a) gated this as
    // market-sizing in save_memory_fact (→ pending → invisible to the check) and
    // (b) would false-close the Stage-2 `market_size` check if applied. With the
    // shared keywordMatcher, "tam"∈"trattamento" no longer matches TAM.
    const c = gateChecks(mkSnapshot([
      { content: 'Regulatory: il trattamento dati delle PMI italiane implica obbligo di GDPR compliance.' },
    ]));
    expect(c.regulatory_check).toBe(true); // GDPR/compliance/regulatory still match
    expect(c.market_size).toBe(false); // "tam"∈"trattamento" must NOT count as TAM
  });

  it('keywordMatcher: acronyms are whole-word, longer keywords keep plural/suffix reach', () => {
    expect(keywordMatcher(['TAM', 'SAM', 'SOM']).test('trattamento dati')).toBe(false);
    expect(keywordMatcher(['TAM', 'SAM', 'SOM']).test('some sample')).toBe(false);
    expect(keywordMatcher(['TAM', 'SAM', 'SOM']).test('our TAM is 5B')).toBe(true);
    expect(keywordMatcher(['channel']).test('paid channels')).toBe(true); // plural preserved
    expect(keywordMatcher(['persona']).test('our personas')).toBe(true); // plural preserved
  });

  it('1A market checks (pain / differentiation / market_size) close on ITALIAN prose', () => {
    const c = gateChecks(mkSnapshot([
      { content: 'Il problema principale dei dentisti è la gestione manuale dei richiami pazienti.' },
      { content: 'Ci distinguiamo dai gestionali desktop legacy perché siamo cloud e mobile-first.' },
      { content: 'Dimensione del mercato: circa 40.000 studi dentistici in Italia.' },
    ]));
    expect(c.pain_validated).toBe(true);
    expect(c.differentiation_evidence).toBe(true);
    expect(c.market_size).toBe(true);
  });

  it('file-dump / monitor facts do NOT count (gate integrity)', () => {
    const fromFile = gateChecks(mkSnapshot([
      { content: 'feasibility dependency regulatory GDPR architecture', source_type: 'file', kind: 'file_upload' },
    ]));
    const fromMonitor = gateChecks(mkSnapshot([
      { content: 'feasibility dependency regulatory GDPR architecture', source_type: 'monitor', kind: 'observation' },
    ]));
    expect(fromFile.tech_feasibility).toBe(false);
    expect(fromMonitor.regulatory_check).toBe(false);
  });
});
