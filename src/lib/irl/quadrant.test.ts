import { describe, it, expect } from 'vitest';
import { quadrantFor, scoreIsHigh, quadrantMessageKey, IRL_DEVELOPED_BAR } from './quadrant';
import { IRL_SCORE_BAR } from './ladder';
import { en } from '@/lib/i18n/messages/en';
import { it as itMessages } from '@/lib/i18n/messages/it';

/**
 * Score × IRL — the founder's four-quadrant framing (2026-08-04). Score is
 * volatile (idea quality); IRL is earned (investability). Collapsing them was
 * the thing he explicitly did NOT want.
 */

describe('the four quadrants', () => {
  const HIGH = 80;   // 'strong'
  const LOW = 45;    // 'caution' — clears IRL_SCORE_BAR but is not promising
  const DEV = IRL_DEVELOPED_BAR;
  const RAW = IRL_DEVELOPED_BAR - 1;

  it('score alto + IRL alto -> da tenere d’occhio', () => {
    expect(quadrantFor(HIGH, DEV)).toBe('watch');
  });
  it('score alto + IRL basso -> promettente ma acerbo', () => {
    expect(quadrantFor(HIGH, RAW)).toBe('promising_raw');
  });
  it('score basso + IRL alto -> ben sviluppata, potenziale basso', () => {
    expect(quadrantFor(LOW, DEV)).toBe('developed_low_potential');
  });
  it('score basso + IRL basso -> scartare o pivotare', () => {
    expect(quadrantFor(LOW, RAW)).toBe('discard_or_pivot');
  });
});

describe('an unscored project is unmeasured, not bad', () => {
  it('returns null rather than guessing a verdict', () => {
    for (const s of [null, undefined, 0, NaN]) {
      expect(quadrantFor(s as number | null, 4)).toBeNull();
    }
  });

  it('a legacy fabricated 0 never reads as "low potential"', () => {
    // The same 0-is-unscored rule the ladder applies to research rows.
    expect(quadrantFor(0, 4)).toBeNull();
  });
});

describe('the score axis is stricter than the ladder\'s rung-2 bar', () => {
  it('rung 2 and the quadrant score-axis now share the GO bar', () => {
    // History: rung 2 sat at 40 (caution floor) and this test pinned that the
    // quadrant's "promising" axis was STRICTER. The Clarity split gave the
    // first score explicit verdicts and rung 2 was raised to the GO bar
    // (2026-08-07) — a rung earned on a "fix something first" score
    // contradicts itself. The two bars now agree at 70; if either moves
    // independently again, this is the assertion that forces the discussion.
    expect(IRL_SCORE_BAR).toBe(70);
    expect(scoreIsHigh(IRL_SCORE_BAR)).toBe(true);
  });

  it('reuses band() boundaries exactly — 55 promising, 54 not', () => {
    expect(scoreIsHigh(55)).toBe(true);
    expect(scoreIsHigh(54)).toBe(false);
    expect(scoreIsHigh(70)).toBe(true);
  });
});

describe('the IRL axis is absolute, not scaled to the current ceiling', () => {
  it('a project at the developed bar reads developed regardless of the cap', () => {
    // The reachable ceiling is 4 today (#338) only because upstream feeds are
    // missing. If the bar scaled to it, a project's quadrant would silently
    // change the day an unrelated PR merged.
    expect(IRL_DEVELOPED_BAR).toBe(4);
    expect(quadrantFor(80, 4)).toBe('watch');
    expect(quadrantFor(80, 3)).toBe('promising_raw');
  });

  it('level 0 (nothing earned) is never "developed"', () => {
    expect(quadrantFor(90, 0)).toBe('promising_raw');
  });
});

describe('every quadrant has copy in both locales', () => {
  it('resolves EN + IT for all four', () => {
    const all = ['watch', 'promising_raw', 'developed_low_potential', 'discard_or_pivot'] as const;
    for (const q of all) {
      const key = quadrantMessageKey(q);
      expect((en as Record<string, string>)[key], `EN ${key}`).toBeTruthy();
      expect((itMessages as Record<string, string>)[key], `IT ${key}`).toBeTruthy();
    }
  });
});
