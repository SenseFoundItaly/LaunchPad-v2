import { describe, it, expect } from 'vitest';
import { toScore100, band } from './score-display';

/**
 * The 0-100 canon, enforced at the renderer.
 *
 * #249 unified the scale on the write side and on Home; the artifact renderers
 * kept trusting `artifact.max`, so a model emitting /10 put a bare "6.8" in
 * front of the founder. Luca asked about it on 21/07 and again on 04/08 with a
 * screenshot — these lock the fix.
 */

describe('toScore100', () => {
  it('converts the /10 scale that caused the complaint', () => {
    expect(toScore100(6.8, 10)).toBe(68);
    expect(toScore100(10, 10)).toBe(100);
  });

  it('leaves a /100 score untouched', () => {
    expect(toScore100(68, 100)).toBe(68);
    expect(toScore100(87, 100)).toBe(87);
  });

  it('normalises ANY scale, not just /10', () => {
    // Proportional on purpose: an unexpected /5 or /20 would otherwise render
    // as a wildly wrong percentage instead of being corrected.
    expect(toScore100(4, 5)).toBe(80);
    expect(toScore100(15, 20)).toBe(75);
  });

  it('treats a missing or zero max as already /100 rather than dividing by it', () => {
    expect(toScore100(68, undefined)).toBe(68);
    expect(toScore100(68, null)).toBe(68);
    expect(toScore100(68, 0)).toBe(68);
  });

  it('clamps instead of rendering an impossible bar', () => {
    expect(toScore100(150, 100)).toBe(100);
    expect(toScore100(-5, 100)).toBe(0);
    expect(toScore100(NaN, 10)).toBe(0);
  });

  it('lands in the band the founder sees on Home', () => {
    // The renderer and the Home badge must agree — that was the whole
    // complaint: "perché copilot in decimi e home in centesimi?"
    expect(band(toScore100(8.7, 10)).key).toBe('score.band-strong');
    expect(band(toScore100(4.5, 10)).key).toBe('score.band-caution');
  });
});
