/**
 * Signal Activity Log — fire-and-forget audit trail for the signal pipeline.
 *
 * Every interesting event (scrape, classification, alert creation, monitor run,
 * chat-created signal) writes one row to signal_activity_logs. The Log tab in
 * the Signals page consumes these via GET /api/projects/{id}/signal-logs.
 *
 * All callers should wrap logSignalActivity in .catch(() => {}) so a logging
 * failure never breaks the primary flow.
 */

import { run } from '@/lib/db';
import { generateId } from '@/lib/api-helpers';

export type SignalEventType =
  | 'signal_created'
  | 'signal_dismissed'
  | 'signal_promoted'
  | 'watch_source_scraped'
  | 'watch_source_created'
  | 'watch_source_error'
  | 'monitor_ran'
  | 'monitor_failed'
  | 'classification_completed'
  | 'brief_generated'
  | 'signal_auto_created_from_chat';

export type SignalEntityType =
  | 'ecosystem_alert'
  | 'watch_source'
  | 'source_change'
  | 'monitor'
  | 'monitor_run'
  | 'intelligence_brief';

export interface LogSignalActivityInput {
  project_id: string;
  event_type: SignalEventType;
  entity_id?: string;
  entity_type?: SignalEntityType;
  headline: string;
  metadata?: Record<string, unknown>;
}

export async function logSignalActivity(input: LogSignalActivityInput): Promise<string> {
  const id = generateId('slog');
  await run(
    `INSERT INTO signal_activity_logs
       (id, project_id, event_type, entity_id, entity_type, headline, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.project_id,
    input.event_type,
    input.entity_id ?? null,
    input.entity_type ?? null,
    input.headline,
    JSON.stringify(input.metadata ?? {}),
  );
  return id;
}
