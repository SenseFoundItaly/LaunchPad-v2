/**
 * Skill-output quality gate.
 *
 * A skill can "run" yet produce no real deliverable — only questions back at the
 * founder ("I'd love to run this analysis! What's your startup idea?"). Such
 * clarification-only output must NOT be treated as a completed skill, because it
 * otherwise:
 *   1. renders on founder surfaces (intelligence / knowledge) as if it were real
 *      research ("ran 23h ago"),
 *   2. is fed to the chat agent as "[COMPLETED SKILL DATA — you MUST reference
 *      this]", so the agent parrots the junk, and
 *   3. scores stage readiness from nothing (section_scores off an empty output).
 *
 * Used at the WRITE side (skill-executor.runSkill, POST /skills) to persist the
 * row as status='incomplete' with no section_scores, and as a defensive filter
 * on READERS for legacy rows already saved as 'completed'.
 *
 * Heuristic is deliberately CONSERVATIVE — real deliverables carry structure, so
 * we only flag output that lacks STRONG structure (no JSON, headers, or tables —
 * a bare numbered/bulleted list does NOT count, since LLMs format clarifying
 * questions as lists) AND reads like a clarification request AND has ≥2 question
 * marks up front. Empty /
 * whitespace output counts as incomplete (nothing was produced). This biases
 * toward false negatives (let some junk through) over false positives (never
 * discard a real deliverable).
 */

// Phrases a skill uses when it's asking for input rather than delivering output.
const CLARIFICATION_RE =
  /\b(i need|i'd love|i would love|could you (?:share|tell|provide|give|describe)|can you (?:share|tell|provide)|what(?:'s| is| are) your|tell me (?:more|about)|to (?:get|run) started|before i (?:can|begin|start)|please (?:share|provide|describe|tell|let me know))\b/i;

// STRONG structure markers a real deliverable carries: JSON braces/brackets,
// markdown headers, or markdown tables. Plain numbered/bulleted lists are
// deliberately EXCLUDED: an LLM formats a list of clarifying questions ("1. What
// does your product do? 2. Who is the customer?") as a numbered list, so a list
// alone must not exempt output from the gate. (Confirmed: a market-research run
// asked 5 numbered questions and was wrongly persisted as 'completed' because the
// old regex treated the numbered list as deliverable structure.)
const STRONG_STRUCTURE_RE = /[{}[\]]|(?:^|\n)\s*#{1,6}\s|(?:^|\n)\s*\|.*\|/;

export function isClarificationOnly(summary: string | null | undefined): boolean {
  const text = (summary ?? '').trim();
  if (text.length === 0) return true; // nothing produced → not a deliverable
  const head = text.slice(0, 400);
  const questionMarks = (head.match(/\?/g) ?? []).length;
  const looksLikeClarification = CLARIFICATION_RE.test(head) && questionMarks >= 2;
  if (!looksLikeClarification) return false; // not asking for input → it's a deliverable
  // Reads like a clarification request. Spare it ONLY if it ALSO carries strong
  // deliverable structure (JSON / headers / table) — a question list is not one.
  return !STRONG_STRUCTURE_RE.test(text);
}
