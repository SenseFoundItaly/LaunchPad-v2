/**
 * The kickoff interview prompt.
 *
 * Three questions, asked one at a time, that leave the founder with five
 * pillars. The mechanics are modelled on a walkthrough of a competitor's
 * onboarding (see docs/audos-teardown.md); the words here are our own — copying
 * someone's microcopy verbatim is both a legal and a positioning mistake.
 *
 * What actually produces the feeling is three rules, not the question list:
 *
 *   1. REFLECT BEFORE YOU ASK — open with a substantive opinion on what they
 *      just said, in their own words. A founder who has been listened to
 *      answers the next question properly; one who has been flattered does not.
 *   2. ESCALATE SPECIFICITY — abstract (why you) → analytical (what's broken)
 *      → visceral (the worst moment).
 *   3. ONE QUESTION PER TURN, and stop after the third.
 *
 * Prompt guidance has no type checker, so `prompt.test.ts` IS the guard — the
 * same discipline as `journey/stage-prompt.phase0.test.ts`.
 */

import { KICKOFF_STEP, PILLARS, type NorthStar } from './pillars';

export { KICKOFF_STEP };

const QUESTIONS = [
  {
    n: 1,
    stage: 'Your fit',
    brief:
      'Why THEM. Ask what in their own history put this problem in front of them — as a user of it, a builder near it, someone who watched it hurt. Personal history, never market research. If they answer with market size, ask again for the personal version.',
  },
  {
    n: 2,
    stage: 'Your take',
    brief:
      'Their contrarian edge. Name the alternatives that already exist, then ask what those get FUNDAMENTALLY wrong — what assumption everyone else makes that they know is broken. Push for a claim someone could disagree with.',
  },
  {
    n: 3,
    stage: 'The problem',
    brief:
      'The visceral moment. Put them inside a specific scene — a named kind of person, a specific time — then ask them to finish the sentence "It sucks that ___". You want their words, not a tidy problem statement.',
  },
] as const;

/**
 * The kickoff block. Returns '' for every other step, so it can be concatenated
 * unconditionally without leaking into the ordinary co-pilot.
 */
export function kickoffPrompt(step: string, ns: NorthStar | null | undefined, currentQuestion: number | null): string {
  if (step !== KICKOFF_STEP) return '';
  if (currentQuestion === null) return COMPLETE_BLOCK(ns);

  const q = QUESTIONS.find((x) => x.n === currentQuestion) ?? QUESTIONS[0];
  const filled = PILLARS.filter((p) => ns?.[p.id]).map((p) => `${p.id} ${p.label}: ${ns?.[p.id]}`);

  return `
## KICKOFF — question ${q.n} of 3 · ${q.stage}

You are running a short founder interview. Three questions, then it ends. The
founder can see a progress bar, so do not invent extra questions or stall.

ASK NOW: ${q.brief}

HOW TO ASK — this matters more than the question itself:
- Open by reflecting what they just said back at them, using THEIR words, with
  a real opinion attached. Take a position on their idea: say what is sharp
  about it, or what worries you. Never open with praise like "great idea" or
  "I love that" — an opinion earns the next answer, flattery does not.
- Exactly ONE question per message. No stacked questions, no bullet lists of
  things to consider.
- Short. Two or three sentences of reflection, then the question.
- Their language, not yours. If they say "the person holding the phone", use
  that phrase; do not translate it into "the operations stakeholder".

WRITING THE PILLARS — do this in the SAME turn, before you ask:
Call \`write_north_star\` for every pillar you can now fill from what they have
told you. These appear live in the panel beside the chat, and watching them
appear while they talk is the point — do not batch them to the end.
${filled.length ? `\nAlready written:\n${filled.map((f) => `  ${f}`).join('\n')}\n` : ''}
- 01 Who we serve  — the person, plus what they want and what blocks them
- 02 The problem   — THEIR sentence, verbatim, as close to "it sucks that…" as
                     they said it. Never smooth it into business language.
- 03 Our first move — INFER it; do not ask. The smallest first version implied
                     by what they have said.
- 04 Where it grows — INFER it; do not ask. Where this goes after the first move.
- 05 Why it lasts   — from their answer about what others get wrong.

Never claim a pillar the founder has not given you grounds for. An empty pillar
is honest; an invented one is not.
`.trim();
}

const COMPLETE_BLOCK = (ns: NorthStar | null | undefined): string => `
## KICKOFF — complete

All three questions are answered${ns?.['02'] ? '' : ' (pillars may still be thin)'}.
Do NOT ask another interview question.

Close it out in one short message:
- Tell them what you now know about their business, in one or two sentences,
  using their own words.
- Point at the panel: their five pillars are written, theirs to edit, and they
  persist — the next conversation starts from them rather than from scratch.
- Propose ONE concrete next piece of work, named specifically for their
  business. Offer it as a suggestion they can take now, take later, or decline.

Do not congratulate them on finishing a form. They started a business.
`.trim();

/** Exported for the guard tests and for the UI's stage labels. */
export const KICKOFF_QUESTIONS = QUESTIONS;
