/**
 * Monitor second-pass alert extraction — the deterministic safety net for
 * the monitor signal loop.
 *
 * Failure mode this closes (observed prod, run mrun_zb1oznt139be): the scan
 * agent performs a real investigation, FINDS material signals, but the
 * stream ends (tool budget / timeout / model drift) without parseable
 * :::artifact{"type":"ecosystem_alert"} blocks — so ecosystem_alerts_inserted
 * stays 0 and no signal ever reaches the founder's inbox.
 *
 * Defense layers, in order:
 *   1. Prompt: emit-as-you-go rules in outputInstructions (+ retrofit via
 *      withEmissionDiscipline for legacy stored prompts).
 *   2. Budget headroom: maxToolCalls + timeout at the run call sites so the
 *      agent has a forced final text turn.
 *   3. THIS MODULE: when the primary parse finds 0 alerts on a substantive
 *      transcript, make ONE non-streaming, tool-less LLM call that does
 *      nothing but transcribe the scan's confirmed findings into the exact
 *      artifact contract, then parse + persist through the SAME path the
 *      primary parse uses (extractEcosystemAlerts / persistEcosystemAlerts).
 *
 * Both run paths (manual run route + cron) call extractAlertsSecondPass,
 * gated on primary-parse-found-0.
 */

import { runAgent } from '@/lib/pi-agent';
import { recordUsage } from '@/lib/cost-meter';
import { pickModel } from '@/lib/llm/router';
import { outputInstructions } from '@/lib/ecosystem-monitors';
import {
  extractEcosystemAlerts,
  persistEcosystemAlerts,
  type ParsedEcosystemAlert,
} from '@/lib/ecosystem-alert-parser';

/** Below this the transcript carries no extractable substance — skip the call. */
const MIN_TRANSCRIPT_CHARS = 500;
/** Transcripts are agent prose (not tool dumps) so they are usually small,
 * but cap defensively: keep the head (scan framing) and a larger tail (where
 * confirmed findings + final synthesis live). */
const HEAD_CHARS = 10000;
const TAIL_CHARS = 20000;
const MAX_TRANSCRIPT_CHARS = HEAD_CHARS + TAIL_CHARS;
const EXTRACT_TIMEOUT_MS = 60000;

/**
 * Router task label for the extraction call. Constraints:
 *   - must be an EXISTING label in src/lib/llm/router.ts;
 *   - this is the safety net, so format-following reliability beats cost:
 *     cheap-tier models demonstrably drop the :::artifact contract
 *     (chat on Haiku 4.5 / gpt-4o-mini emitted 0/8 structured artifacts),
 *     which would make the net silently useless.
 * 'assumption-extract' is the closest existing label (a structured
 * extraction pass) and routes to the balanced tier (Sonnet).
 */
const EXTRACT_TASK = 'assumption-extract' as const;

export interface SecondPassInput {
  projectId: string;
  monitorId: string;
  /** monitor_runs row id the recovered alerts should attach to. */
  monitorRunId: string;
  /** monitors.type — used only for the usage-log step label. */
  monitorType: string;
  /** The scan agent's full text output (monitor_runs.summary content). */
  scanTranscript: string;
  locale: 'en' | 'it';
  /** Which run path invoked us — usage-log step prefix ('manual' | 'cron'). */
  trigger: 'manual' | 'cron';
}

export interface SecondPassOutcome {
  /** false = gate said don't even call the LLM (short transcript). */
  attempted: boolean;
  skipped_reason?: 'transcript_too_short' | 'extract_call_failed';
  alerts_inserted: number;
  pending_actions_created: number;
  /** The recovered alerts — callers reuse these for the founder-facing
   * alerts row + memory-fact mirroring, exactly like primary-parse output. */
  parsed: ParsedEcosystemAlert[];
  parse_errors: number;
}

const NONE_OUTCOME: Omit<SecondPassOutcome, 'attempted' | 'skipped_reason'> = {
  alerts_inserted: 0,
  pending_actions_created: 0,
  parsed: [],
  parse_errors: 0,
};

function truncateTranscript(transcript: string): string {
  if (transcript.length <= MAX_TRANSCRIPT_CHARS) return transcript;
  return `${transcript.slice(0, HEAD_CHARS)}\n\n[... transcript truncated ...]\n\n${transcript.slice(-TAIL_CHARS)}`;
}

function buildExtractionPrompt(transcript: string, locale: 'en' | 'it'): string {
  // The instruction frame stays English (system-side contract language used
  // across the agent stack); the embedded outputInstructions block is
  // locale-correct, and the language-mirroring line keeps IT projects'
  // headlines/bodies in Italian.
  return [
    'You are given the transcript of a competitive-intelligence scan that already ran.',
    'Your ONLY job is to extract the material findings that the scan CONFIRMED into ecosystem_alert artifacts, in EXACTLY the format below.',
    'Rules:',
    '- Extract ONLY findings present in the transcript. Do not investigate further. Do not add knowledge of your own.',
    '- Never fabricate URLs: source_url must be a URL that appears in the transcript (or null if none was given for that finding).',
    '- Write headline and body in the same language as the transcript.',
    '- If the transcript contains no material confirmed finding, output exactly: NONE',
    '',
    outputInstructions(locale),
    '',
    'SCAN TRANSCRIPT:',
    '"""',
    truncateTranscript(transcript),
    '"""',
  ].join('\n');
}

/**
 * Run the second-pass extraction and persist whatever it recovers.
 *
 * Never throws: any failure (LLM error, timeout, parse misses) degrades to a
 * zero-alert outcome with a warn log — the safety net must not be able to
 * fail the monitor run that invoked it.
 */
export async function extractAlertsSecondPass(input: SecondPassInput): Promise<SecondPassOutcome> {
  const transcript = (input.scanTranscript || '').trim();
  if (transcript.length < MIN_TRANSCRIPT_CHARS) {
    return { attempted: false, skipped_reason: 'transcript_too_short', ...NONE_OUTCOME };
  }

  const prompt = buildExtractionPrompt(transcript, input.locale);

  let text = '';
  const startedAt = Date.now();
  try {
    // ONE non-streaming call, no tools — pure transcript→artifact transcription.
    const res = await runAgent(prompt, {
      tools: false,
      timeout: EXTRACT_TIMEOUT_MS,
      task: EXTRACT_TASK,
    });
    text = res.text;

    // Meter the extraction like every other monitor LLM call so it counts
    // toward the project budget.
    const { provider, model } = pickModel(EXTRACT_TASK);
    recordUsage({
      project_id: input.projectId,
      step: `${input.trigger}.${input.monitorType}.second_pass_extract`,
      provider,
      model,
      usage: res.usage as Parameters<typeof recordUsage>[0]['usage'],
      latency_ms: Date.now() - startedAt,
    }).catch(err =>
      console.warn('[monitor-extract] recordUsage failed:', (err as Error).message),
    );
  } catch (err) {
    console.warn(
      `[monitor-extract] second-pass extraction call failed for monitor ${input.monitorId} (run ${input.monitorRunId}):`,
      (err as Error).message,
    );
    return { attempted: true, skipped_reason: 'extract_call_failed', ...NONE_OUTCOME };
  }

  // SAME parse path as the primary pass — no second parser.
  const { parsed, errors } = extractEcosystemAlerts(text);
  if (errors.length > 0) {
    console.warn(
      `[monitor-extract] second pass produced ${errors.length} unparseable artifact(s) — first reason:`,
      errors[0].reason,
    );
  }
  if (parsed.length === 0) {
    console.log(
      `[monitor-extract] second pass found nothing material for monitor ${input.monitorId} (run ${input.monitorRunId})`,
    );
    return { attempted: true, ...NONE_OUTCOME, parse_errors: errors.length };
  }

  // SAME persistence path as the primary pass — dedupe_hash, competitor
  // profiles, auto-queued pending_actions all included.
  const persist = await persistEcosystemAlerts(parsed, {
    projectId: input.projectId,
    monitorId: input.monitorId,
    monitorRunId: input.monitorRunId,
    autoQueueRelevanceThreshold: 0.8,
    maxPendingActionsPerRun: 5,
  });

  console.log(
    `[monitor-extract] LAYER=second_pass recovered ${persist.alerts_inserted} alert(s) (+${persist.pending_actions_created} pending action(s)) for monitor ${input.monitorId} (run ${input.monitorRunId}) — primary parse had found 0`,
  );

  return {
    attempted: true,
    alerts_inserted: persist.alerts_inserted,
    pending_actions_created: persist.pending_actions_created,
    parsed,
    parse_errors: errors.length,
  };
}
