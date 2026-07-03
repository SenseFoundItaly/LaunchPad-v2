import { describe, it, expect } from 'vitest';
import { runSummaryDisplay } from './monitor-run-summary';

describe('runSummaryDisplay', () => {
  it('failed run → failed', () => {
    expect(runSummaryDisplay({ status: 'failed', alerts_generated: 0, summary: 'boom' }).kind).toBe('failed');
  });

  it('still running → none', () => {
    expect(runSummaryDisplay({ status: 'running', alerts_generated: 0, summary: '' }).kind).toBe('none');
  });

  it('completed, 0 alerts, clean text → all-clear', () => {
    expect(
      runSummaryDisplay({ status: 'completed', alerts_generated: 0, summary: 'Reviewed 6 competitor pages; pricing and positioning unchanged.' }).kind,
    ).toBe('all-clear');
  });

  it('completed, 0 alerts, empty text → all-clear', () => {
    expect(runSummaryDisplay({ status: 'completed', alerts_generated: 0, summary: '' }).kind).toBe('all-clear');
  });

  it('completed, 0 alerts, search-outage text → source-unavailable', () => {
    const samples = [
      'The web search tool is returning zero results across all queries this session.',
      'Jina read HTTP 402 — the search layer is unavailable.',
      "I couldn't reach the database to load prior context.",
      'As an AI, I was not able to access any live sources this run.',
      'Rate-limit exceeded on the search provider.',
    ];
    for (const summary of samples) {
      expect(runSummaryDisplay({ status: 'completed', alerts_generated: 0, summary }).kind).toBe('source-unavailable');
    }
  });

  it('completed WITH alerts + clean prose → text (shows the finding)', () => {
    const summary = 'PandaDoc shipped usage-based pricing tiers; relevant to your GTM.';
    const r = runSummaryDisplay({ status: 'completed', alerts_generated: 2, summary });
    expect(r.kind).toBe('text');
    expect(r.kind === 'text' && r.text).toBe(summary);
  });

  it('completed WITH alerts but apology prose → none (count line carries it)', () => {
    const r = runSummaryDisplay({ status: 'completed', alerts_generated: 1, summary: "I apologise, my web search tool is not working." });
    expect(r.kind).toBe('none');
  });
});
