import { describe, it, expect } from 'vitest';
import { isBaselineScoreTitle, to100, band, normalizeDimensions } from './score-display';

describe('isBaselineScoreTitle', () => {
  it('matches project-baseline titles (EN + IT), not per-dimension ones', () => {
    expect(isBaselineScoreTitle('DeskMate — Baseline Startup Score')).toBe(true);
    expect(isBaselineScoreTitle('Overall Score')).toBe(true);
    expect(isBaselineScoreTitle('Punteggio complessivo del progetto')).toBe(true);
    // per-dimension / unrelated score-cards stay thin
    expect(isBaselineScoreTitle('Team strength')).toBe(false);
    expect(isBaselineScoreTitle('Competitive landscape')).toBe(false);
    expect(isBaselineScoreTitle('')).toBe(false);
    expect(isBaselineScoreTitle(undefined)).toBe(false);
  });
});

describe('to100', () => {
  it('scales legacy 0-10 up, leaves 0-100 alone', () => {
    expect(to100(6.8)).toBeCloseTo(68);
    expect(to100(10)).toBe(100);
    expect(to100(58)).toBe(58);
    expect(to100(0)).toBe(0);
  });
});

describe('band', () => {
  it('bands on the 0-100 scale', () => {
    expect(band(72).key).toBe('score.band-strong');
    expect(band(58).key).toBe('score.band-promising');
    expect(band(45).key).toBe('score.band-caution');
    expect(band(30).key).toBe('score.band-weak');
  });
});

describe('normalizeDimensions', () => {
  it('reads the object-map, array, and json-string shapes', () => {
    expect(normalizeDimensions({ Market: 79, Team: 52 })).toEqual([
      { name: 'Market', score: 79 }, { name: 'Team', score: 52 },
    ]);
    expect(normalizeDimensions([{ name: 'X', score: 5 }])).toEqual([{ name: 'X', score: 5 }]);
    expect(normalizeDimensions('{"A":10}')).toEqual([{ name: 'A', score: 10 }]);
    expect(normalizeDimensions(null)).toEqual([]);
  });
});
