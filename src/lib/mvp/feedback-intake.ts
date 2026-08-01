// ============================================================================
// Backlog intake from the intelligence surfaces (GitHub #268).
//
// Two cron-side converters feed the SAME ingestFeedback() path as the chat
// tool and the Build pane, so every signal deduplicates into the issue layer:
//
//  - INTERVIEWS: pains from interviews conducted AFTER the project's first
//    build. (Earlier interviews already shape the initial brief via
//    assembleMvpContext — re-ingesting them as "feedback" would double-count.)
//  - WATCHER (live monitor): significant source_changes on the published MVP's
//    own watch_source (registered by publishBuild/PATCH live_app_url).
//
// Both are idempotent via source_ref_id (one feedback row per interview /
// change, ever) and bounded per tick. LLM cost: only the intake classifier
// (cheap tier) per NEW item — the scans themselves are pure SQL.
// ============================================================================

import { query } from '@/lib/db';
import { ingestFeedback } from './build-issues';

/** Interviews → backlog. Returns how many new feedback rows were created. */
export async function ingestInterviewFeedback(limit = 10): Promise<number> {
  // Projects with a live build; interviews conducted after that project's
  // FIRST build; not already ingested (source_ref_id is the idempotency key).
  const rows = await query<{
    id: string;
    project_id: string;
    top_pain: string | null;
    summary: string;
    urgency: string | null;
    person_segment: string | null;
  }>(
    `SELECT i.id, i.project_id, i.top_pain, i.summary, i.urgency, i.person_segment
       FROM interviews i
      WHERE i.top_pain IS NOT NULL AND length(trim(i.top_pain)) > 0
        AND EXISTS (SELECT 1 FROM mvp_builds b WHERE b.project_id = i.project_id AND b.status = 'live')
        AND i.created_at > (SELECT min(b2.created_at) FROM mvp_builds b2 WHERE b2.project_id = i.project_id)
        AND NOT EXISTS (
          SELECT 1 FROM mvp_build_feedback f
           WHERE f.project_id = i.project_id AND f.source = 'interview' AND f.source_ref_id = i.id
        )
      ORDER BY i.created_at ASC
      LIMIT ?`,
    limit,
  );
  let n = 0;
  for (const iv of rows) {
    try {
      const who = iv.person_segment ? ` (${iv.person_segment})` : '';
      await ingestFeedback({
        projectId: iv.project_id,
        source: 'interview',
        sourceRefId: iv.id,
        body: `Interview pain${who}: ${iv.top_pain!.trim()}`.slice(0, 2000),
        severity: iv.urgency === 'high' ? 'high' : 'medium',
      });
      n++;
    } catch (err) {
      console.warn('[feedback-intake] interview ingest failed:', (err as Error).message);
    }
  }
  return n;
}

/** Significant live-app watcher changes → backlog. Returns rows created. */
export async function ingestWatcherFeedback(limit = 10): Promise<number> {
  // Only changes on the build's OWN watch_source (the published MVP), with a
  // non-noise significance (classified upstream by the watch-source processor).
  const rows = await query<{
    id: string;
    project_id: string;
    diff_summary: string | null;
    significance: string;
    significance_rationale: string | null;
  }>(
    `SELECT sc.id, sc.project_id, sc.diff_summary, sc.significance, sc.significance_rationale
       FROM source_changes sc
      WHERE sc.significance IN ('high', 'medium')
        AND EXISTS (
          SELECT 1 FROM mvp_builds b
           WHERE b.project_id = sc.project_id AND b.watch_source_id = sc.watch_source_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM mvp_build_feedback f
           WHERE f.project_id = sc.project_id AND f.source = 'live_monitor' AND f.source_ref_id = sc.id
        )
      ORDER BY sc.detected_at ASC
      LIMIT ?`,
    limit,
  );
  let n = 0;
  for (const sc of rows) {
    try {
      const body = [
        `Live app monitor detected a ${sc.significance}-significance change`,
        sc.diff_summary ? `: ${sc.diff_summary}` : '',
        sc.significance_rationale ? ` (${sc.significance_rationale})` : '',
      ].join('');
      await ingestFeedback({
        projectId: sc.project_id,
        source: 'live_monitor',
        sourceRefId: sc.id,
        body: body.slice(0, 2000),
        severity: sc.significance === 'high' ? 'high' : 'medium',
      });
      n++;
    } catch (err) {
      console.warn('[feedback-intake] watcher ingest failed:', (err as Error).message);
    }
  }
  return n;
}
