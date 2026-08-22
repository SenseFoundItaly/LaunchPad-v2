import { describe, it, expect } from 'vitest';
import {
  SECTIONS, SECTION_IDS, coerceSections, auditSummary, sectionById,
  type Sections,
} from './sections';

/**
 * The audit fills seven sections from one or two founder sentences. That is
 * only honest while `confidence` is trustworthy — these tests are the parts of
 * "trustworthy" that can be checked without a model.
 */

const sec = (text: string, confidence: string, risk = 'r') =>
  ({ text, confidence, risk, updatedAt: '2026-08-22T00:00:00Z' }) as unknown;

describe('confidence can only ever degrade', () => {
  it('an unrecognised confidence reads as assumed, never grounded', () => {
    // The direction matters more than the default. Reading a corrupt or
    // unknown value as "grounded" would launder a guess into the founder's
    // mouth — the one failure that makes the whole audit worthless.
    const out = coerceSections({ customer: sec('Dog owners', 'very-sure') });
    expect(out.customer.confidence).toBe('assumed');
  });

  it('a missing confidence reads as assumed', () => {
    const out = coerceSections({ customer: { text: 'Dog owners', risk: 'r' } });
    expect(out.customer.confidence).toBe('assumed');
  });

  it('the three real rungs survive a round trip', () => {
    // Text must clear the 3-char floor or the section is dropped before its
    // confidence is ever read — a one-letter fixture tests nothing.
    const out = coerceSections({
      customer: sec('Dog owners', 'grounded'),
      problem: sec('Trust gap', 'inferred'),
      gtm: sec('Local vet referrals', 'assumed'),
    });
    expect([out.customer.confidence, out.problem.confidence, out.gtm.confidence])
      .toEqual(['grounded', 'inferred', 'assumed']);
  });
});

describe('coerceSections drops what it cannot trust', () => {
  it('ignores keys that are not sections', () => {
    const out = coerceSections({ customer: sec('Dog owners', 'grounded'), nonsense: sec('x', 'grounded') });
    expect(Object.keys(out)).toEqual(['customer']);
  });

  it('drops a section whose text is too short to be an answer', () => {
    expect(coerceSections({ customer: sec('ok', 'grounded') })).toEqual({});
  });

  it('survives junk instead of an object', () => {
    expect(coerceSections(null)).toEqual({});
    expect(coerceSections('nope')).toEqual({});
    expect(coerceSections({ customer: 'a string' })).toEqual({});
  });
});

describe('the audit summary tells the truth about weak sections', () => {
  const filled: Sections = coerceSections(
    Object.fromEntries(SECTION_IDS.map((id, i) => [
      id,
      sec(`Section ${id} content`, i === 0 ? 'grounded' : i < 3 ? 'inferred' : 'assumed', `risk for ${id}`),
    ])),
  );

  it('counts each rung separately rather than averaging them', () => {
    const a = auditSummary(filled);
    expect(a.filled).toBe(SECTIONS.length);
    expect(a.grounded + a.inferred + a.assumed).toBe(SECTIONS.length);
    // No single score anywhere in the shape: one unexamined assumption can sink
    // the idea, and a percentage is exactly what would hide it.
    expect(a).not.toHaveProperty('score');
  });

  it('puts assumptions first, so the weakest link is read first', () => {
    const order = auditSummary(filled).risks.map((r) => r.confidence);
    expect(order[0]).toBe('assumed');
    expect(order[order.length - 1]).toBe('grounded');
  });

  it('is not complete while any section is empty', () => {
    const partial = coerceSections({ customer: sec('Dog owners', 'grounded') });
    const a = auditSummary(partial);
    expect(a.complete).toBe(false);
    expect(a.filled).toBe(1);
  });

  it('a section with no risk line is not listed as a risk', () => {
    const noRisk = coerceSections({ customer: sec('Dog owners', 'grounded', '') });
    expect(auditSummary(noRisk).risks).toEqual([]);
  });
});

describe('the section catalogue is coherent', () => {
  it('every section id resolves, and ids are unique', () => {
    expect(new Set(SECTION_IDS).size).toBe(SECTIONS.length);
    for (const id of SECTION_IDS) expect(sectionById(id)?.id).toBe(id);
  });

  it('every promotable section targets a real idea_canvas column', () => {
    // Promotion writes these column names straight into the canvas upsert. A
    // typo here would be a silent no-op the founder reads as "saved".
    const canvas = new Set([
      'problem', 'solution', 'target_market', 'business_model',
      'channels', 'competitive_advantage',
    ]);
    for (const s of SECTIONS) {
      if (s.promotesTo) expect(canvas.has(s.promotesTo), s.id).toBe(true);
    }
  });

  it('every section is bilingual — the panel renders beside an Italian chat', () => {
    for (const s of SECTIONS) {
      expect(s.labelIt.length, s.id).toBeGreaterThan(0);
      expect(s.blurbIt.length, s.id).toBeGreaterThan(0);
    }
  });
});
