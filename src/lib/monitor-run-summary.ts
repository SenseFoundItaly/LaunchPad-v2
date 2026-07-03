/**
 * Founder-facing display for a watcher run's outcome.
 *
 * A monitor run stores the agent's raw transcript tail as `summary`. On the
 * ~84% of runs that surface no alert that transcript is usually the model
 * apologising that web search is broken, that it "can't reach the database", or
 * (worse) leaking an off-project executor's chatter — none of which a founder
 * should ever read as "what my watcher found". This maps a run to a small,
 * localised verdict instead:
 *
 *   - failed              → the run errored; a neutral retry line
 *   - source-unavailable  → completed with 0 alerts AND the text looks like a
 *                           search/provider outage or a model apology
 *   - all-clear           → completed with 0 alerts and clean text (the healthy
 *                           "checked, nothing moved" case)
 *   - text                → a genuine finding: show the (clean) prose
 *   - none                → nothing to show (still running, or an alert-bearing
 *                           run whose prose is just apology noise — the alert
 *                           count line already conveys "N signals")
 *
 * Pure + deterministic so the detectors are unit-testable; the component maps
 * `kind` → t() for locale.
 */

export type RunSummaryDisplay =
  | { kind: 'all-clear' }
  | { kind: 'source-unavailable' }
  | { kind: 'failed' }
  | { kind: 'text'; text: string }
  | { kind: 'none' };

export interface RunSummaryInput {
  status: string;
  alerts_generated: number;
  summary: string | null;
}

// Search/provider/infra outage phrasing — the Jina-402 era filled runs with
// exactly these. Kept broad because the model phrases the same failure many ways.
const INFRA_FAIL_RE =
  /(web[\s-]?search|search (?:tool|layer|is|returned|provider)|http\s*4\d\d|402|no (?:search )?results|couldn'?t (?:reach|access|find|retrieve)|unable to (?:reach|access|retrieve|search)|data\s?base (?:is )?(?:un)?(?:available|reachable)|provider error|rate[\s-]?limit|quota (?:exceeded|exhausted)|no data (?:source|available)|infrastructure (?:issue|failure))/i;

// Model self-reference / apology — even without an explicit infra word, this
// reads as broken product, not a finding.
const APOLOGY_RE =
  /(i (?:apologi|couldn'?t|could not|was unable|don'?t have|cannot|can'?t|do not have)|as an ai|i'?m (?:sorry|unable|not able)|my (?:web )?search (?:tool|is|layer)|i was not able)/i;

function looksBroken(text: string): boolean {
  return INFRA_FAIL_RE.test(text) || APOLOGY_RE.test(text);
}

export function runSummaryDisplay(run: RunSummaryInput): RunSummaryDisplay {
  const n = run.alerts_generated ?? 0;
  const s = (run.summary ?? '').trim();

  if (run.status === 'failed') return { kind: 'failed' };
  if (run.status !== 'completed') return { kind: 'none' };

  if (n > 0) {
    // A real finding — show its prose, but never a model apology (that would
    // undercut the very signal the count line is announcing).
    if (s && !looksBroken(s)) return { kind: 'text', text: s };
    return { kind: 'none' };
  }

  // Completed, zero alerts: the dominant case. Broken text → honest outage
  // label; clean text → reassuring all-clear.
  if (s && looksBroken(s)) return { kind: 'source-unavailable' };
  return { kind: 'all-clear' };
}
