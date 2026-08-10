import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { GATE_FACT_FAMILIES, matchGateFactFamily, isGateMovingFact } from './gate-fact-families';
import { checkGap } from './journey-prompts';

/**
 * The consent invariant: nothing turns a gate step green without the founder's
 * explicit yes — a promise the Home spine makes to him in his own language
 * ("nulla viene validato senza il tuo sì").
 *
 * The 2026-08-09 audit found save_memory_fact honouring that for exactly ONE
 * keyword family (market size) while 15 others wrote auto-applied facts that
 * greened their checks silently. These tests pin both halves of the fix: the
 * family list has ONE home, and the tool routes gate-moving content to an
 * approval card instead of straight to memory.
 */

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf-8');

describe('the gate family list has exactly one home', () => {
  it('covers every keyword family the gate checks read', () => {
    // 16 families: 14 Stage-2 + 2 Stage-4. A new gate check with its own
    // keyword family must be added HERE, or its fact auto-applies again.
    expect(GATE_FACT_FAMILIES).toHaveLength(16);
    const kinds = new Set<string>(GATE_FACT_FAMILIES.map((f) => f.kind));
    for (const k of ['market_size_fact', 'tech_fact', 'gtm_fact', 'jtbd_fact', 'revenue_stream_fact']) {
      expect(kinds.has(k), `family ${k} must be in the shared list`).toBe(true);
    }
    // tech_fact splits across three checks by `field` — losing a field silently
    // drops feasibility / dependencies / regulatory from the consent gate.
    const techFields = GATE_FACT_FAMILIES.filter((f) => f.kind === 'tech_fact').map((f) => f.field);
    expect(new Set(techFields)).toEqual(new Set(['feasibility', 'dependencies', 'regulatory']));
  });

  it('chat-fact-sweep derives from it instead of keeping a copy', () => {
    const sweep = read('src/lib/chat-fact-sweep.ts');
    expect(sweep).toContain("from '@/lib/gate-fact-families'");
    // The old local table must not come back — that duplication is what let
    // the two lists drift apart in the first place.
    expect(sweep).not.toMatch(/const FAMILIES:\s*SweepFamily\[\]\s*=/);
  });

  it('save_memory_fact derives from it too, and no longer tests one family', () => {
    const tools = read('src/lib/project-tools.ts');
    expect(tools).toContain('matchGateFactFamily(content)');
    expect(tools).not.toMatch(/keywordMatcher\(\[\.\.\.MARKET_SIZE_KEYWORDS\]\)\.test\(content\)/);
  });
});

describe('matching is whole-word, not substring', () => {
  it('matches a real market-size statement', () => {
    expect(matchGateFactFamily('Il TAM europeo vale circa 30 miliardi')?.kind).toBe('market_size_fact');
  });

  it('does NOT match "tam" hidden inside an Italian word', () => {
    // "trattamento" (= processing) is common in GDPR/regulatory prose; a bare
    // .includes('tam') once flagged it as market sizing.
    const fam = matchGateFactFamily('Il trattamento dei dati richiede una base giuridica');
    expect(fam?.kind).not.toBe('market_size_fact');
  });

  it('recognises gate-moving content in BOTH languages', () => {
    expect(isGateMovingFact('the main technical risk is data freshness')).toBe(true);
    expect(isGateMovingFact('processes EU SME data → GDPR applies')).toBe(true);
    // Plain context facts stay auto-applied — the "facts applied by default"
    // decision still holds for anything that cannot green a check.
    expect(isGateMovingFact('Maria preferisce le riunioni al mattino')).toBe(false);
  });
});

describe('a gate-moving fact becomes an approval card, never a pending fact', () => {
  it('stages a validation item instead of calling recordFact', () => {
    const tools = read('src/lib/project-tools.ts');
    expect(tools).toMatch(/if \(gateFamily\)[\s\S]{0,900}stageValidationItemsFromRaw\(/);
  });

  it('never routes gate facts through reviewedState pending', () => {
    // A pending memory_fact materializes as `proposed_graph_update`, which
    // action-lanes.ts routes OUT of the Inbox for the alpha — the founder
    // would never see it and the check could never green. Same invisible-card
    // class as the premortem cards.
    const tools = read('src/lib/project-tools.ts');
    expect(tools).not.toMatch(/reviewedState: 'pending' as const/);
  });

  it('tells the model not to claim the step is done', () => {
    const tools = read('src/lib/project-tools.ts');
    expect(tools).toMatch(/do NOT claim the step is complete|never claim the step is complete/i);
  });
});

describe('the Italian spine keeps the founder oriented (2026-08-09 audit)', () => {
  const t = ((key: string, vars?: Record<string, unknown>) => {
    const table: Record<string, string> = {
      'journey-gap.interviews_logged': 'Registra almeno 5 interviste',
      'journey-gap.gate_verdict': 'Prendi la decisione — registra GO, PIVOT o STOP',
      'journey-gap.gate_verdict-stop': 'Hai scelto STOP su questa idea — riapri il gate se vuoi riprendere',
      'journey-gap.gate_verdict-pivot': 'Hai scelto PIVOT — rivedi le prove deboli, poi decidi di nuovo',
      'journey-gap.gate_verdict-pivot-scope': `Hai scelto PIVOT sul track ${vars?.scope} — rifai quelle prove`,
    };
    return table[key] ?? key;
  }) as never;

  it('carries the evaluator count into the localized hint', () => {
    // Was byte-identical at 0 and at 4 of 5 — the founder could not tell
    // whether he was one interview from green or five.
    const at4 = checkGap('interviews_logged', '4 of 5 — tell the Co-pilot "I talked to X about Y" to log', t, 'it');
    const at0 = checkGap('interviews_logged', '0 of 5 — tell the Co-pilot "I talked to X about Y" to log', t, 'it');
    expect(at4).toContain('4/5');
    expect(at0).toContain('0/5');
    expect(at4).not.toBe(at0);
    expect(at4).toContain('Registra almeno 5 interviste');
  });

  it('degrades to the plain sentence when there is no count', () => {
    expect(checkGap('interviews_logged', 'Log your first interview', t, 'it'))
      .toBe('Registra almeno 5 interviste');
  });

  it('English keeps the evaluator string verbatim', () => {
    const gap = '4 of 5 — tell the Co-pilot "I talked to X about Y" to log';
    expect(checkGap('interviews_logged', gap, t, 'en')).toBe(gap);
  });

  it('the four gate verdict states stay distinguishable in Italian', () => {
    const stop = checkGap('gate_verdict', 'You called STOP on this idea — reopen the gate if you want to resume', t, 'it');
    const pivot = checkGap('gate_verdict', 'You called PIVOT — rework the weak evidence, then make the call again', t, 'it');
    const scoped = checkGap('gate_verdict', 'You called PIVOT on track 1A — rework that evidence, then make the call again', t, 'it');
    const undecided = checkGap('gate_verdict', 'Make the call — review the gate evidence and record GO, PIVOT or STOP', t, 'it');

    expect(stop).toContain('STOP');
    expect(pivot).toContain('PIVOT');
    expect(scoped).toContain('1A'); // the scope must survive
    // The decisive assertion: a recorded decision must never read like no decision.
    expect(new Set([stop, pivot, scoped, undecided]).size).toBe(4);
  });
});
