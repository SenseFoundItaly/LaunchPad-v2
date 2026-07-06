import { describe, it, expect } from 'vitest';
import { parseScoreSummary } from './score-summary';

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
