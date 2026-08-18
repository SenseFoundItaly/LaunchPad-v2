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

describe('the CTA is wired to the handler that owns the money', () => {
  const spine = read('src/components/canvas/SpineSection.tsx');
  const page = read('src/app/project/[projectId]/chat/page.tsx');

  it('the spine delegates rather than fetching /skills itself', () => {
    // A raw fetch here would reimplement the 402 recharge modal and the 422
    // prerequisite surfaces — badly, and in a second place.
    expect(spine).toContain('onRunSkill');
    expect(spine).not.toMatch(/fetch\([^)]*\/skills/);
  });

  it('the chat page routes it to skill:run', () => {
    expect(page).toMatch(/onRunSkill=\{\(skillId\)/);
    expect(page).toContain("handleArtifactAction('skill:run', { skill_id: skillId })");
  });

  it('a run in flight blocks a second click', () => {
    expect(spine).toMatch(/if \(runningSkill \|\| !onRunSkill\) return;/);
  });

  it('the CTA never renders on a locked or already-green row', () => {
    expect(spine).toMatch(/const runnableSkill = isGap \? checkRunnableSkill/);
    expect(spine).toMatch(/runnableSkill && !locked && onRunSkill/);
  });

  it('nothing auto-runs — the founder clicks', () => {
    // "Troppo veicolato" (04/08): the product must not decide for the founder,
    // and must not spend on a project they have not chosen to advance.
    expect(spine).not.toMatch(/useEffect\([^)]*startSkill/);
  });
});
