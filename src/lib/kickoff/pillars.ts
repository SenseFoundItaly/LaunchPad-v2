/**
 * The five pillars, and why three questions fill them.
 *
 * Launchpad Lite's kickoff asks THREE questions and produces FIVE pillars.
 * That is not a shortcut — two pillars are INFERRED by the agent from what the
 * founder said, rather than asked for directly. Asking five questions would
 * make the interview feel like a form; asking three and deriving two makes it
 * feel like being listened to.
 *
 * Nothing here reads or writes gate evidence. These pillars live in their own
 * table (`north_star`, migration 042) precisely so the agent can write them
 * live without an approval card. Promotion into `idea_canvas` is a separate,
 * founder-clicked act — see `promotesTo`.
 */

export const KICKOFF_STEP = 'kickoff' as const;

export type PillarId = '01' | '02' | '03' | '04' | '05';

export interface Pillar {
  id: PillarId;
  /** Founder-facing label. */
  label: string;
  labelIt: string;
  /** Asked outright, or inferred by the agent from the other answers. */
  source: 'asked' | 'inferred';
  /** Which kickoff question fills it (asked pillars only). */
  question?: 1 | 2 | 3;
  /**
   * The `idea_canvas` column this pillar becomes IF the founder promotes it.
   * Every target already exists — the lite kickoff needs no canvas migration.
   */
  promotesTo: string;
}

export const PILLARS: readonly Pillar[] = [
  { id: '01', label: 'Who we serve',   labelIt: 'Chi serviamo',      source: 'asked',    question: 1, promotesTo: 'target_market' },
  { id: '02', label: 'The problem',    labelIt: 'Il problema',       source: 'asked',    question: 3, promotesTo: 'problem' },
  { id: '03', label: 'Our first move', labelIt: 'La prima mossa',    source: 'inferred',              promotesTo: 'solution' },
  { id: '04', label: 'Where it grows', labelIt: 'Dove cresce',       source: 'inferred',              promotesTo: 'channels' },
  { id: '05', label: 'Why it lasts',   labelIt: 'Perché dura',       source: 'asked',    question: 2, promotesTo: 'competitive_advantage' },
] as const;

export const PILLAR_IDS: readonly PillarId[] = PILLARS.map((p) => p.id);

/** The three pillars a question asks for — the ones progress is measured on. */
export const ASKED_PILLARS: readonly PillarId[] = PILLARS.filter((p) => p.source === 'asked').map((p) => p.id);

export type NorthStar = Partial<Record<PillarId, string>>;

/** A pillar counts as filled only with real content — a stray space is not an answer. */
export function isFilled(value: string | undefined | null): boolean {
  return typeof value === 'string' && value.trim().length >= 3;
}

/**
 * Progress, DERIVED — there is deliberately no stored status.
 *
 * A status column and the document it describes will drift; this repo has been
 * bitten twice (projects.current_step vs journey activeStage, and the check-kind
 * list kept in four hand-copies). Counting the pillars means the progress bar
 * cannot lie, and it self-heals: answer two things in one message and progress
 * jumps correctly with no reconciliation code.
 *
 * `complete` doubles as the reveal gate for anything generated in parallel.
 */
export function kickoffProgress(
  ns: NorthStar | null | undefined,
  /**
   * How many times the founder has actually replied in this thread.
   *
   * Needed because the two things I first conflated are different: the DOCUMENT
   * can run ahead of the CONVERSATION. On a project that already has a canvas,
   * the agent legitimately fills 01 and 02 from existing context before the
   * founder has said a word — and the first live run did exactly that, showing
   * "Question 1 of 3" in the chat while the bar claimed question 3.
   *
   * So: pillars measure the document, founder turns measure the interview.
   * Both stay derived — still no stored status.
   */
  founderTurns = 0,
): {
  /** Pillars filled — the document's progress. */
  answered: number;
  total: number;
  /** Both the interview and the document are done. */
  complete: boolean;
  /** 1-3, driven by the CONVERSATION; null once complete. */
  currentQuestion: number | null;
} {
  const answered = ASKED_PILLARS.filter((id) => isFilled(ns?.[id])).length;
  const total = ASKED_PILLARS.length;
  // Never ahead of the conversation, never past the last question.
  const asked = Math.min(founderTurns + 1, total);
  const complete = answered >= total && founderTurns >= total;
  return { answered, total, complete, currentQuestion: complete ? null : asked };
}

/** Normalise whatever came out of JSONB into a NorthStar, dropping junk keys. */
export function coerceNorthStar(raw: unknown): NorthStar {
  if (!raw || typeof raw !== 'object') return {};
  const src = raw as Record<string, unknown>;
  const out: NorthStar = {};
  for (const id of PILLAR_IDS) {
    const v = src[id];
    if (typeof v === 'string' && v.trim()) out[id] = v.trim().slice(0, 2000);
  }
  return out;
}

export function pillarById(id: string): Pillar | undefined {
  return PILLARS.find((p) => p.id === id);
}
