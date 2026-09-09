import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { STAGES } from './index';
import { checkLabel } from '@/lib/journey-prompts';
import { en } from '@/lib/i18n/messages/en';
// Aliased: the Italian message map is exported as `it`, which would shadow
// vitest's own `it`.
import { it as itMessages } from '@/lib/i18n/messages/it';

/**
 * Changelog 05/09 item 1 — "Le tasks del copilot vanno bene ma solamente per i
 * primi due stages. Possiamo già rivedere anche tasks e stage successivi?"
 *
 * This is the SECOND time it was asked. The 28/08 changelog answered it by
 * adding `planned[]` to the stage definitions, with translated labels for every
 * entry — and then nothing read the field. It crossed the wire on every
 * /stages response and no surface rendered it, so from the founder's seat
 * nothing had changed and Stage 3 still looked like a three-task stage.
 *
 * These pin the wiring, not the data: the failure mode was never a missing
 * definition, it was a definition with no consumer.
 */

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf-8');
const planned = STAGES.flatMap((s) => (s.planned ?? []).map((p) => ({ stage: s.number, ...p })));

describe('the roadmap the founder can see', () => {
  it('later stages carry one', () => {
    // Stage 4 has eight real checks and needs no filler; the rest of 3-7 were
    // the thin ones Luca was looking at.
    const stagesWithRoadmap = new Set(planned.map((p) => p.stage));
    expect([...stagesWithRoadmap].sort()).toEqual([3, 5, 6, 7]);
    expect(planned.length).toBe(10);
  });

  it('the spine actually renders it — the bug was a field with no consumer', () => {
    const spine = read('src/components/canvas/SpineSection.tsx');
    expect(spine).toMatch(/openEval\.stage\.planned/);
    expect(spine).toMatch(/canvas\.planned-label/);
    // Ghosted and inert: no onClick, no prompt prefill. A fake-clickable row
    // that leads nowhere is worse than an absent one.
    const block = spine.slice(spine.indexOf('canvas.planned-label'));
    expect(block.slice(0, 1400)).not.toMatch(/onPickPrompt|onClick=/);
  });

  it('never counts against the founder', () => {
    // A planned item carries no evaluate(), so it can never be red. The repo
    // invariant it protects: a check reading a column nothing fills is
    // permanently unmet, and a stage that can't be finished is a dead end.
    for (const stage of STAGES) {
      expect(stage.checks.length, `stage ${stage.number} total`).toBeGreaterThan(0);
      for (const p of stage.planned ?? []) {
        expect(stage.checks.find((c) => c.id === p.id), `${p.id} must not be a real check`).toBeUndefined();
        expect(p).not.toHaveProperty('evaluate');
      }
    }
  });
});

describe('it reads as the product, in both languages', () => {
  it('every roadmap row has a translated label — no raw English on an Italian spine', () => {
    // Asserted through checkLabel, the function the spine actually calls: it
    // falls back to the raw definition string when a row has no key, so a
    // missing translation shows up as English text on an Italian screen rather
    // than as an error anyone would notice.
    const tEn = ((k: string) => en[k as keyof typeof en]) as Parameters<typeof checkLabel>[2];
    const tIt = ((k: string) => itMessages[k as keyof typeof itMessages]) as Parameters<typeof checkLabel>[2];
    for (const p of planned) {
      const enLabel = checkLabel(p.id, p.label, tEn);
      const itLabel = checkLabel(p.id, p.label, tIt);
      expect(enLabel, `${p.id} en`).toBeTruthy();
      expect(itLabel, `${p.id} it`).toBeTruthy();
      expect(itLabel, `${p.id} is untranslated — the Italian spine would show English`).not.toBe(enLabel);
    }
  });

  it('and so does the chrome around them', () => {
    for (const k of ['canvas.planned-label', 'canvas.planned-tip', 'canvas.planned-soon'] as const) {
      expect(en[k], `${k} en`).toBeTruthy();
      expect(itMessages[k], `${k} it`).toBeTruthy();
    }
  });
});

describe('the co-pilot knows what the founder is looking at', () => {
  const prompt = read('src/lib/journey/stage-prompt.ts');

  it('the roadmap reaches the prompt — "modificare di conseguenza anche la prima risposta"', () => {
    expect(prompt).toMatch(/stage\.planned/);
    expect(prompt).toMatch(/ON THE ROADMAP/);
  });

  it('and is fenced as not-workable, so it cannot become the next step', () => {
    // Without this the agent reads ten task names and starts driving toward one
    // that has nowhere to record an answer — the exact dead end item 11 was.
    expect(prompt).toMatch(/NOT workable yet/);
    expect(prompt).toMatch(/[Nn]ever set one as the next step/);
  });

  it('sits after the MISSING list, not inside it', () => {
    const missing = prompt.indexOf('MISSING (drive the conversation');
    const roadmap = prompt.indexOf('...plannedLines');
    expect(missing).toBeGreaterThan(-1);
    expect(roadmap).toBeGreaterThan(missing);
  });
});

describe('it survives the trip to the browser', () => {
  it('planned is plain data, so the /stages JSON carries it', () => {
    // `checks` carry evaluate() and are stripped per-check by the evaluator;
    // planned entries are {id,label} and must round-trip untouched.
    const revived = JSON.parse(JSON.stringify(STAGES.find((s) => s.number === 3)));
    expect(revived.planned).toHaveLength(3);
    expect(revived.planned[0].label).toBeTruthy();
  });
});
