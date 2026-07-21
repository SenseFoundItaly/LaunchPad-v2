import { describe, it, expect } from 'vitest';
import { validationTargetsFor, validationLabel } from './validation-targets';
import { TECH_1B_SOURCES } from './stage-2-market-validation';
import { extractTechnicalFindings } from '@/lib/auto-stage-validation';

// The technical-validation deterministic fallback (cert 2026-07-07) stages
// `tech_fact` items so the three 1B checks can close even when the model emits
// prose instead of parseable insight-cards. These assert the item→check wiring
// can't drift from the spine sources.

describe('tech_fact validation targets', () => {
  it('maps each finding to its 1B check(s)', () => {
    // The feasibility finding targets BOTH split checks (2026-07: the one
    // feasibility card carries build approach AND biggest technical risk).
    const f = validationTargetsFor('tech_fact', 'feasibility');
    expect(f.map((t) => t.check_id)).toEqual(['build_approach', 'technical_risk_named']);
    const d = validationTargetsFor('tech_fact', 'dependencies');
    expect(d.map((t) => t.check_id)).toEqual(['key_dependencies']);
    const r = validationTargetsFor('tech_fact', 'regulatory');
    expect(r.map((t) => t.check_id)).toEqual(['regulatory_check']);
  });

  it('all three findings land in Stage 2 (Validation Gate)', () => {
    for (const field of ['feasibility', 'dependencies', 'regulatory'] as const) {
      const t = validationTargetsFor('tech_fact', field);
      expect(t[0]?.stage_number).toBe(2);
      expect(validationLabel(t)).toMatch(/Stage 2/);
    }
  });

  it('an unknown / missing field maps to no check (never a phantom green)', () => {
    expect(validationTargetsFor('tech_fact')).toEqual([]);
    expect(validationTargetsFor('tech_fact', 'bogus')).toEqual([]);
  });

  it('the exported 1B source constants are the exact check sources (drift guard)', () => {
    // If a 1B check source is renamed without updating TECH_1B_SOURCES, the
    // target lookup returns [] and this test catches the silent break.
    expect(validationTargetsFor('tech_fact', 'feasibility')[0]?.check_id).toBe('build_approach');
    expect(TECH_1B_SOURCES.feasibility).toContain('feasibility');
    expect(TECH_1B_SOURCES.dependencies).toContain('dependencies');
    expect(TECH_1B_SOURCES.regulatory).toContain('regulatory');
  });
});

describe('extractTechnicalFindings', () => {
  // Mirrors the real technical-validation summary shape: `---` dividers between
  // `###` sections (cert 2026-07-07: the divider broke the first parser, and the
  // recordFact text-dedup collapsed identical fallbacks — hence label prefixes).
  const summary = `## Validazione Tecnica — Gate 1B

---

### 1. Fattibilità tecnica
L'approccio è consolidato: computer vision on-device è maturo. Rischio sull'hardware edge.

---

### 2. Dipendenze chiave
Dipende da modelli di visione open-source e da fornitori di camere 4K. Integrazione con API di storage.

---

### 3. Vincoli normativi
Il Garante Privacy impone il consenso per i minori; GDPR sulla ripresa video.`;

  it('returns three DISTINCT, label-prefixed findings that each carry their keyword', () => {
    const f = extractTechnicalFindings(summary, 'it')!;
    expect(f).not.toBeNull();
    // distinct (recordFact dedups by exact text — identical would collapse)
    expect(new Set([f.feasibility, f.dependencies, f.regulatory]).size).toBe(3);
    // each carries its own check keyword (so the matching 1B check closes)
    expect(f.feasibility.toLowerCase()).toMatch(/fattibil/);
    expect(f.dependencies.toLowerCase()).toMatch(/dipendenz/);
    expect(f.regulatory.toLowerCase()).toMatch(/normativ|garante|gdpr/);
  });

  it('a `---` divider does not truncate a section into an empty finding', () => {
    const f = extractTechnicalFindings(summary, 'it')!;
    // regression: the feasibility body must be real content, never a bare "---"
    expect(f.feasibility.replace(/Fattibilità tecnica — /, '').trim()).not.toMatch(/^-*$/);
    expect(f.feasibility).toMatch(/computer vision|consolidat/i);
  });

  it('English locale uses English prefixes (still keyword-bearing)', () => {
    const f = extractTechnicalFindings('A substantial technical assessment of feasibility, dependencies and regulatory constraints for the product build.', 'en')!;
    expect(f.feasibility).toMatch(/Technical feasibility/);
    expect(f.dependencies).toMatch(/Key dependencies/);
    expect(f.regulatory).toMatch(/Regulatory/);
  });

  it('returns null for thin / clarification-only output', () => {
    expect(extractTechnicalFindings('Serve più contesto.', 'it')).toBeNull();
  });
});
