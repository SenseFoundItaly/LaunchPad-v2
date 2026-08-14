/**
 * The interview pipeline's states (#398, migration 040).
 *
 * "Cold users listed", "cold users outreach" and the interview itself are
 * three states of ONE record, not three tables — which is why the first two
 * had nothing to count while `interviews` could only hold conducted ones.
 *
 * ONE definition, imported everywhere: the check, the chat tool, the REST
 * route and the executor. The recurring bug class in this codebase is a list
 * kept by hand in four places, three of them stale.
 */

export const INTERVIEW_STATUSES = ['listed', 'contacted', 'scheduled', 'done'] as const;
export type InterviewStatus = (typeof INTERVIEW_STATUSES)[number];

/**
 * NULL/unknown reads as 'done'.
 *
 * Every writer that predates migration 040 — `log_interview`, the upload
 * digest, POST /interviews — records a conversation that HAPPENED, so a row
 * that never states a status is a conducted interview. Defaulting the other
 * way would silently demote all 84 rows in prod out of `interviews_logged`.
 */
export function interviewStatus(raw: string | null | undefined): InterviewStatus {
  const v = String(raw ?? '').trim().toLowerCase();
  return (INTERVIEW_STATUSES as readonly string[]).includes(v) ? (v as InterviewStatus) : 'done';
}

/** Outreach happened: the founder made contact, whatever came of it. A done
 *  interview implies it — you cannot have interviewed someone you never
 *  reached. */
export function hasBeenContacted(raw: string | null | undefined): boolean {
  return interviewStatus(raw) !== 'listed';
}

/** The conversation actually took place. This — not mere existence of a row —
 *  is what `interviews_logged`, the pain/WTP checks and the PSF canvas
 *  baseline all mean by "an interview". */
export function isConducted(raw: string | null | undefined): boolean {
  return interviewStatus(raw) === 'done';
}
