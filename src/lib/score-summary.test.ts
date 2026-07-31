import { describe, it, expect } from 'vitest';
import { parseScoreSummary, weakestDimensions } from './score-summary';

describe('parseScoreSummary — JSON contract (skill Output Format)', () => {
  it('reads the fenced startup_score JSON before any prose number (live E2E 2026-07-21 shape)', () => {
    // Narrative mentions a dimension "30/100" BEFORE the JSON — the prose
    // fallback used to grab it as the overall (stored 30 when the JSON said 47).
    const summary = [
      'Ho tutti i dati necessari. La domanda dei clienti è debole (30/100 nella mia stima iniziale).',
      '',
      '```json',
      JSON.stringify({
        startup_score: {
          overall_score: 47,
          overall_grade: 'C+',
          summary: "TurniFacili è un'idea DUBBIA allo stadio attuale.",
          dimensions: {
            market_opportunity: { score: 55, weight: 0.2, rationale: 'r' },
            competitive_landscape: { score: 40, weight: 0.15 },
            customer_demand: { score: 30, weight: 0.2 },
          },
        },
      }),
      '```',
    ].join('\n');

    const r = parseScoreSummary(summary)!;
    expect(r.overall).toBe(47);
    expect(r.dimensions).toEqual({
      'Market opportunity': 55,
      'Competitive landscape': 40,
      'Customer demand': 30,
    });
    expect(r.benchmark).toBe('Grade C+');
    expect(r.recommendation).toMatch(/DUBBIA/);
  });

  it('a malformed json fence falls back to prose parsing', () => {
    const summary = '```json\n{ not valid json\n```\nOverall Score: 61/100';
    const r = parseScoreSummary(summary)!;
    expect(r.overall).toBe(61);
  });
});

describe('parseScoreSummary', () => {
  it('parses numbered + emoji-prefixed dimension headers (real startup-scoring format)', () => {
    const summary = [
      '# 🏗️ FieldPulse — Startup Scorecard',
      '',
      '## 📊 Overall Score: **51 / 100 — Grade: C+**',
      '',
      '> **Verdict: NOT READY to scale.** Real problem, but no validated demand.',
      '',
      '## Dimension Scores',
      '',
      '### 1. 🌍 Market Opportunity — **62 / 100** *(Weight: 20%)*',
      'Rationale text.',
      '### 2. ⚔️ Competitive Landscape — **45 / 100** *(Weight: 15%)*',
      '### 3. 🛠️ Feasibility — **60 / 100**',
      '### 4. 💰 Business Model Viability — **50 / 100**',
      '### 5. 📈 Customer Demand — **38 / 100**',
      '### 6. 🎯 Execution Risk — **55 / 100**',
    ].join('\n');

    const r = parseScoreSummary(summary)!;
    expect(r).not.toBeNull();
    expect(r.overall).toBe(51);
    expect(r.dimensions).toEqual({
      'Market Opportunity': 62,
      'Competitive Landscape': 45,
      Feasibility: 60,
      'Business Model Viability': 50,
      'Customer Demand': 38,
      'Execution Risk': 55,
    });
    expect(r.benchmark).toBe('Grade C+');
    expect(r.recommendation).toMatch(/NOT READY to scale/);
  });

  it('parses an Italian scorecard (Punteggio Complessivo / Verdetto / Voto / accented dimensions)', () => {
    const summary = [
      '# 🏗️ FieldPulse — Scorecard della Startup',
      '',
      '## 📊 Punteggio Complessivo: **58 / 100 — Voto: C+**',
      '',
      '> **Verdetto: NON PRONTA a scalare.** Problema reale, ma domanda non ancora validata.',
      '',
      '## Punteggi per Dimensione',
      '',
      "### 1. 🌍 Opportunità di Mercato — **62 / 100** *(Peso: 20%)*",
      'Motivazione.',
      '### 2. ⚔️ Panorama Competitivo — **45 / 100**',
      '### 3. 🛠️ Fattibilità — **60 / 100**',
      '### 4. 💰 Sostenibilità del Modello di Business — **50 / 100**',
    ].join('\n');

    const r = parseScoreSummary(summary)!;
    expect(r).not.toBeNull();
    expect(r.overall).toBe(58);
    expect(r.dimensions).toEqual({
      'Opportunità di Mercato': 62,
      'Panorama Competitivo': 45,
      'Fattibilità': 60,
      'Sostenibilità del Modello di Business': 50,
    });
    expect(r.benchmark).toBe('Grade C+');
    expect(r.recommendation).toMatch(/NON PRONTA a scalare/);
  });

  it('parses "Raccomandazione:" as the recommendation anchor', () => {
    const r = parseScoreSummary('Punteggio complessivo: 70/100\nRaccomandazione: valida la domanda prima di costruire.')!;
    expect(r.overall).toBe(70);
    expect(r.recommendation).toMatch(/valida la domanda/);
  });

  it('parses plain "Name: 72/100" headers', () => {
    const r = parseScoreSummary('Overall Score: 70/100\nMarket Opportunity: 72/100\nTeam: 68/100')!;
    expect(r.overall).toBe(70);
    expect(r.dimensions).toEqual({ 'Market Opportunity': 72, Team: 68 });
  });

  it('scales "/10" dimensions to /100', () => {
    const r = parseScoreSummary('Overall Score: 80/100\n**Solution Clarity** — 8/10')!;
    expect(r.dimensions).toEqual({ 'Solution Clarity': 80 });
  });

  it('returns null when no overall score is present', () => {
    expect(parseScoreSummary('No numeric score here, just prose.')).toBeNull();
  });

  it('returns dimensions=null when overall present but no dimension lines', () => {
    const r = parseScoreSummary('The overall score is 64/100 and that is all.')!;
    expect(r.overall).toBe(64);
    expect(r.dimensions).toBeNull();
  });

  it('does not capture the Overall line itself as a dimension', () => {
    const r = parseScoreSummary('## Overall Score: 51 / 100\n### Market: 62/100')!;
    expect(r.dimensions).toEqual({ Market: 62 });
    expect(Object.keys(r.dimensions!)).not.toContain('Overall Score');
  });
});

describe('weakestDimensions', () => {
  const dims = {
    'Market Opportunity': 62,
    'Competitive Landscape': 45,
    Feasibility: 60,
    'Business Model Viability': 50,
    'Customer Demand': 38,
    'Execution Risk': 55,
  };

  it('returns the worst dimensions below the threshold, ascending, capped at max', () => {
    expect(weakestDimensions(dims, { max: 3, threshold: 60 })).toEqual([
      { name: 'Customer Demand', score: 38 },
      { name: 'Competitive Landscape', score: 45 },
      { name: 'Business Model Viability', score: 50 },
    ]);
  });

  it('excludes scores at or above the threshold (60 is not weak at threshold 60)', () => {
    const names = weakestDimensions(dims, { max: 6, threshold: 60 }).map((w) => w.name);
    expect(names).not.toContain('Feasibility');
    expect(names).not.toContain('Market Opportunity');
    expect(names).toHaveLength(4);
  });

  it('defaults to max 3 / threshold 60', () => {
    expect(weakestDimensions(dims)).toHaveLength(3);
  });

  it('returns [] for null, empty, all-strong, or non-numeric maps', () => {
    expect(weakestDimensions(null)).toEqual([]);
    expect(weakestDimensions(undefined)).toEqual([]);
    expect(weakestDimensions({})).toEqual([]);
    expect(weakestDimensions({ Team: 80, Market: 92 })).toEqual([]);
    expect(weakestDimensions({ Team: NaN, Market: 'high' as unknown as number })).toEqual([]);
  });
});
