import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { withGateFactPrefix, gateFactPrefix, GATE_FACT_PREFIXES } from './gate-fact-families';
import type { GateFactKind } from './gate-fact-kinds';

/**
 * The founder-visible label goes on ONCE.
 *
 * Found in prod data on 2026-08-14 while diagnosing why 1B blocks every
 * project: a memory_fact reading `Rischio tecnico — Rischio tecnico — …`.
 * Several producers already label their value — `extractTechnicalFindings`
 * prefixes each of its three findings, the chat sweep carries the founder's own
 * sentence — and the executor then prefixed again unconditionally. `market_size`
 * had had the idempotent guard since #416; the two `gateFactPrefix` sites never
 * got it.
 */
describe('withGateFactPrefix', () => {
  const kinds = Object.keys(GATE_FACT_PREFIXES) as GateFactKind[];

  it.each(kinds)('%s: prefixes a bare value exactly once', (kind) => {
    const out = withGateFactPrefix(kind, 'it', 'il valore');
    expect(out).toBe(`${gateFactPrefix(kind, 'it')}il valore`);
    // Applying it again is a no-op — the property that was missing.
    expect(withGateFactPrefix(kind, 'it', out)).toBe(out);
  });

  it.each(kinds)('%s: does not re-label a value already carrying the OTHER locale', (kind) => {
    // The cross-locale case a single-locale guard misses: prefixed in English,
    // re-applied under an Italian project → "Rischio tecnico — Technical risk —".
    const en = `${GATE_FACT_PREFIXES[kind].en}the value`;
    expect(withGateFactPrefix(kind, 'it', en)).toBe(en);
    const it_ = `${GATE_FACT_PREFIXES[kind].it}il valore`;
    expect(withGateFactPrefix(kind, 'en', it_)).toBe(it_);
  });

  it('matches the label case-insensitively and tolerates leading space', () => {
    const out = withGateFactPrefix('tech_risk_fact', 'it', ' rischio tecnico — il DB non regge');
    expect(out).toBe(' rischio tecnico — il DB non regge');
  });

  it('still labels a value that merely MENTIONS the words later on', () => {
    // Only a leading label counts. A sentence that happens to contain the
    // phrase must still be labelled, or its check loses the family marker.
    const out = withGateFactPrefix('tech_risk_fact', 'it', 'il rischio tecnico principale è la latenza');
    expect(out.startsWith(gateFactPrefix('tech_risk_fact', 'it'))).toBe(true);
  });
});

describe('the executor applies the label through the once-only helper', () => {
  const src = readFileSync(join(process.cwd(), 'src/lib/action-executors.ts'), 'utf-8');

  it('no site interpolates a raw prefix into the fact any more', () => {
    expect(src).not.toMatch(/fact: `\$\{techPrefix\}\$\{value\}`/);
    expect(src).not.toMatch(/fact: `\$\{prefix\}\$\{value\}`/);
  });

  it('both fact-writing branches go through withGateFactPrefix', () => {
    expect(src.match(/withGateFactPrefix\(/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
