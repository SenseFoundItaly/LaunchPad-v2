/**
 * The audit prompt — one pass, seven sections, every one of them honest.
 *
 * This is the prompt that has to earn the product's central claim: give it a
 * sentence or two and it returns a whole plan WITH its weak points named. The
 * rules below are ordered by how badly each one fails when it is missing.
 */

import { PILLARS, type NorthStar } from './pillars';
import { SECTIONS } from './sections';

export const AUDIT_STEP = 'kickoff:audit' as const;

export function auditPrompt(
  ns: NorthStar,
  locale: 'en' | 'it',
  known: { name: string; description?: string | null; transcript?: string },
  /**
   * Sections still to write. Defaults to all of them.
   *
   * This is what makes the audit resumable. A full pass takes ~150s against a
   * platform that has already truncated one skill at 170s — and because every
   * section persists the moment it is written, a run that dies at section five
   * has genuinely saved five. Asking only for what is missing turns that from
   * "start again and pay twice" into "finish the job".
   */
  only?: readonly string[],
): string {
  const wanted = SECTIONS.filter((s) => !only || only.includes(s.id));
  const alreadyDone = SECTIONS.filter((s) => only && !only.includes(s.id));

  const pillarLines = PILLARS
    .map((p) => (ns[p.id] ? `- ${p.label}: ${ns[p.id]}` : null))
    .filter(Boolean)
    .join('\n');

  const sectionLines = wanted.map((s) => `- ${s.id} — ${s.label}: ${s.blurb}`).join('\n');

  return [
    `You are auditing a founder's idea and writing the first full draft of their plan.`,
    ``,
    `THE VENTURE: ${known.name}`,
    known.description ? `In the founder's words: ${known.description}` : '',
    pillarLines ? `\nWhat they have told you so far:\n${pillarLines}` : '',
    known.transcript ? `\nThe conversation so far:\n${known.transcript}` : '',
    ``,
    `YOUR JOB`,
    alreadyDone.length
      ? `Call write_section ONCE for each of the ${wanted.length} sections below. The others are already written — leave them alone.`
      : `Call write_section ONCE for each of these seven sections. All seven.`,
    `Do not skip one because the founder never mentioned it — an empty box helps`,
    `nobody, and a marked assumption is more useful than silence.`,
    ``,
    sectionLines,
    alreadyDone.length
      ? `\nAlready written (do NOT call write_section for these): ${alreadyDone.map((s) => s.id).join(', ')}`
      : '',
    ``,
    `HOW TO WRITE A SECTION`,
    `- 2-5 sentences. Concrete and specific to THIS venture. If a sentence would`,
    `  survive being pasted into a different startup's plan, it is filler: cut it.`,
    `- Use the founder's own words wherever you have them, especially for the`,
    `  problem. Do not upgrade their language into consultant vocabulary.`,
    `- Name real things: actual channels, actual prices, actual competitors. A`,
    `  wrong specific is useful because it can be corrected; a vague hedge cannot.`,
    ``,
    `THE RISK LINE — this is the part that matters`,
    `Every section takes a "risk": the single thing that would make that section`,
    `WRONG. Not a generic worry. It must be specific enough that the founder could`,
    `go and find out. "Customers may not pay" is useless. "This assumes owners pay`,
    `per booking rather than a monthly membership — if they expect a subscription,`,
    `the unit economics invert" is the job.`,
    ``,
    `CONFIDENCE — do not flatter yourself here`,
    `- "grounded": the founder actually said this. You could quote them.`,
    `- "inferred": you reasoned it from what they said. A defensible step.`,
    `- "assumed": you filled it to keep the plan whole. Nothing supports it.`,
    `Most sections in a first pass are inferred or assumed, and that is the`,
    `expected, honest result. An audit where everything is "grounded" is a broken`,
    `audit — it means you laundered your own guesses into the founder's mouth.`,
    ``,
    `AFTER THE TOOL CALLS`,
    `Write 2-3 short sentences to the founder. Say what you filled in, then name`,
    `the ONE assumption you would test first and why it is the one that decides`,
    `whether the rest holds. No preamble, no bullet list, no restating the plan`,
    `back at them — they can see it on the right.`,
    locale === 'it' ? `\nWrite everything in Italian — the founder works in Italian.` : '',
  ].filter(Boolean).join('\n');
}
