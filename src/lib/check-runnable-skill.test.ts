import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { checkRunnableSkill } from './journey-prompts';
import { STAGES } from './journey';

/**
 * `build_approach` is green on 1 of 116 prod projects and locks 1C on all of
 * them. Its gap text has always said "run Technical Validation" — and nothing
 * in the product could run it: skills reach a founder only when the co-pilot
 * happens to offer one as a card, and `technical-validation` had never been
 * run on any project, ever.
 *
 * The row that names a skill now offers it. What these pin is that the offer
 * stays honest: pointed at a real skill, on a real check, explicit, and routed
 * through the handler that owns the credit and prerequisite gates.
 */
const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf-8');

describe('the check → skill map', () => {
  it('build_approach offers technical-validation', () => {
    expect(checkRunnableSkill('build_approach')).toBe('technical-validation');
  });

  it('no other check claims a skill', () => {
    // Measured across all 7 stages in both locales: build_approach is the only
    // gap that names a runnable skill. A new entry should be a deliberate act.
    const claimed = STAGES.flatMap((s) => s.checks.map((c) => c.id)).filter((id) => checkRunnableSkill(id));
    expect(claimed).toEqual(['build_approach']);
  });

  it('every mapped skill exists on disk', () => {
    // A map entry pointing at a skill that isn't there would render a button
    // that 404s — the same "instruction pointing at nothing" this fixes.
    for (const id of STAGES.flatMap((s) => s.checks.map((c) => c.id))) {
      const skill = checkRunnableSkill(id);
      if (!skill) continue;
      expect(() => readFileSync(join(process.cwd(), `launchpad-skills/${skill}/SKILL.md`)), skill).not.toThrow();
    }
  });

  it('every mapped skill has a display name in BOTH locales', () => {
    const en = read('src/lib/i18n/messages/en.ts');
    const it = read('src/lib/i18n/messages/it.ts');
    for (const id of STAGES.flatMap((s) => s.checks.map((c) => c.id))) {
      const skill = checkRunnableSkill(id);
      if (!skill) continue;
      expect(en, skill).toContain(`'skill-name.${skill}'`);
      expect(it, skill).toContain(`'skill-name.${skill}'`);
    }
  });
});

describe('the gap hint never names a skill the founder cannot start', () => {
  // History: build_approach was green on 1 of 116 prod projects and locked 1C on
  // all of them, because its hint said "run Technical Validation" and nothing in
  // the product could run it. A row-level CTA closed that gap — and then
  // produced findings only loosely aligned to the 1B tasks, discarding the
  // analysis when the skill broke mid-run (changelog 05/09 item 11), so the CTA
  // is gone again. The hint therefore has to point at something that EXISTS.
  it('build_approach points at the Co-pilot, not at a skill button', () => {
    for (const f of ['src/lib/i18n/messages/en.ts', 'src/lib/i18n/messages/it.ts']) {
      const hint = read(f).split('\n').find((l) => l.includes("'journey-gap.build_approach'")) ?? '';
      expect(hint, f).toBeTruthy();
      expect(hint, `${f} still tells the founder to run a skill`).not.toMatch(/Technical Validation|Validazione Tecnica/);
      expect(hint.toLowerCase(), f).toContain('co-pilot');
    }
  });

  it('the spine no longer offers to run a skill from a check row', () => {
    const spine = read('src/components/canvas/SpineSection.tsx');
    expect(spine).not.toMatch(/canvas\.run-skill|checkRunnableSkill|onRunSkill/);
  });
});
