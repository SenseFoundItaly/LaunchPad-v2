/**
 * Grants tracking — the sync. Owns EVERY DB write for funding_calls,
 * funding_source_state and the per-project funding_event alerts.
 *
 * Why this exists: PR #450's first live grants run shipped a past-dated call
 * from the LLM path. Here a call is DATA — the connectors
 * (src/lib/grants/sources/*) parse the deadline from typed source fields in
 * code, and this module upserts by (source, source_identifier) so a deadline
 * extension updates the row in place instead of spawning a duplicate alert.
 *
 * Failure policy (binding, see grants-spec §D1): every failure is LOUD
 * ('[grants]' prefix) and degrades to NO CHANGE —
 *   - a connector that throws or returns ZERO rows records last_error, does
 *     NOT advance last_success_at, and NEVER touches missed_syncs / closes
 *     anything for that source (a broken scraper must not close 380 calls);
 *   - a connector that reports a PARTIAL listing (page cap / row limit hit)
 *     still gets its rows upserted, but mark-missing is SKIPPED for that run
 *     and last_error records 'truncated' — absence from a partial listing is
 *     no evidence of closure;
 *   - a call missing from a SUCCESSFUL, COMPLETE sync only increments
 *     missed_syncs; it closes at >= 2 consecutive misses and any reappearance
 *     resets to 0;
 *   - the once-per-day gate is SQL-side on funding_source_state.last_success_at
 *     (>= CURRENT_DATE), so the twice-daily cron and re-runs are no-ops.
 *
 * Founder-facing consistency (what the alerts say must equal what the row
 * says):
 *   - a higher-fidelity parse is never overwritten by a lower one: a Lombardia
 *     deadline read from the detail page ('regex', carries the hour and the
 *     latest proroga) survives the daily Socrata-only upsert unless Socrata
 *     announces a LATER date (a proroga the page fetch predates);
 *   - when an existing call's deadline/time/status changes, every still-pending
 *     alert headline/body and ticket title for that call is rewritten;
 *   - a call that was closed (expiry or misses) and reappears open is REOPENED
 *     for founders too: its auto-dismissed alerts and auto-rejected tickets go
 *     back to pending, and watchers that never had an alert get one.
 */

import { query, run, get } from '@/lib/db';
import { generateId } from '@/lib/api-helpers';
import { computeDedupeHash } from '@/lib/ecosystem-monitors';
import { translate } from '@/lib/i18n/messages';
import { sediaConnector } from './sources/sedia';
import { lombardiaConnector } from './sources/lombardia';
import { incentiviConnector } from './sources/incentivi';
import type {
  ConnectorResult,
  FetchLike,
  FundingSource,
  NormalizedCall,
  SourceConnector,
  SourceSyncResult,
  SyncOptions,
  SyncResult,
} from './types';
import { formatDeadlineForLocale, toDateOnly } from './dates';
import { excerpt } from './text';

export interface GrantsWatcher {
  project_id: string;
  monitor_id: string;
  locale: 'en' | 'it';
}

type AlertCallInput = Pick<
  NormalizedCall,
  'title' | 'granting_body' | 'deadline' | 'deadline_time' | 'status' | 'eligibility_text'
>;

/** What the upsert hands back: the NEW row plus the row as it was before (all null on insert). */
interface UpsertRow {
  id: string;
  inserted: boolean;
  status: 'open' | 'rolling' | 'closed';
  deadline: string | null;
  deadline_time: string | null;
  prev_status: string | null;
  prev_deadline: string | null;
  prev_deadline_time: string | null;
}

/** A call together with the values the DB actually holds after the upsert. */
interface StoredCall {
  id: string;
  call: NormalizedCall;
}

/**
 * ON CONFLICT guard: keep the stored deadline block when the stored parse is
 * the Lombardia detail page ('regex') and the incoming one is Socrata-only,
 * unless Socrata announces a LATER date (a proroga the page fetch predates).
 * Built once and interpolated (no user input) because ON CONFLICT ... SET has
 * no way to name a boolean once.
 */
/** An incoming 'unread' page_status must never erase a stored ok/failed. */
export const KEEP_PAGE_STATUS_SQL = `excluded.page_status = 'unread'`;

export const KEEP_PAGE_PARSE_SQL = `(funding_calls.status <> 'closed'
             AND funding_calls.parse_method = 'regex'
             AND excluded.parse_method = 'socrata_field'
             AND (excluded.deadline IS NULL OR excluded.deadline <= funding_calls.deadline))`;

const HEADLINE_MAX = 300;
const TITLE_MAX = 160;
const GRANTING_BODY_MAX = 120;

function affectedRows(result: unknown): number {
  // postgres.js returns the affected rows as an array with a `.count` property.
  return (result as { count?: number }).count ?? 0;
}

function zeroResult(source: FundingSource): SourceSyncResult {
  return {
    source,
    ok: false,
    error: null,
    skipped_gate: false,
    partial: false,
    fetched: 0,
    inserted: 0,
    updated: 0,
    reopened: 0,
    closed_missing: 0,
    alerts_created: 0,
    alerts_refreshed: 0,
  };
}

/**
 * Sync every source, then expire past-deadline calls. Connector errors are
 * handled inside syncSource; only DB-level surprises reach the catch here,
 * and they are logged and recorded as a failed source, never rethrown. The
 * phases outside the per-source loop (watcher lookup, expiry) are wrapped
 * too, so a missing migration reads as '[grants] … failed' in the logs and
 * the cron summary keeps whatever per-source results were computed.
 */
export async function syncFundingCalls(opts: SyncOptions = {}): Promise<SyncResult> {
  const now = opts.now ?? new Date();
  const sources = opts.sources ?? [sediaConnector, lombardiaConnector, incentiviConnector];

  let watchers: GrantsWatcher[];
  try {
    watchers = await loadGrantsWatchers();
  } catch (err) {
    const msg = (err as Error).message;
    console.error('[grants] loadGrantsWatchers failed — sync aborted, nothing changed:', msg);
    return { sources: [], expired: 0, alerts_dismissed: 0, error: `loadGrantsWatchers: ${msg}` };
  }

  const results: SourceSyncResult[] = [];
  for (const c of sources) {
    try {
      results.push(await syncSource(c, { now, force: opts.force ?? false, fetch: opts.fetch, watchers }));
    } catch (err) {
      // only DB-level surprises reach here; connector errors are handled inside syncSource
      console.error(`[grants] ${c.source} sync crashed:`, (err as Error).message);
      results.push({ ...zeroResult(c.source), error: (err as Error).message });
    }
  }

  // Every call, gate-independent (cheap UPDATEs).
  let expired = 0;
  let alerts_dismissed = 0;
  let error: string | null = null;
  try {
    ({ expired, alerts_dismissed } = await expireFundingCalls(now));
  } catch (err) {
    const msg = (err as Error).message;
    console.error('[grants] expireFundingCalls failed:', msg);
    error = `expireFundingCalls: ${msg}`;
  }
  return { sources: results, expired, alerts_dismissed, error };
}

/**
 * The ONLY monitor query in grants tracking: one row per non-archived project
 * that has an ACTIVE 'ecosystem.grants' monitor. Projects without one get no
 * funding_event alerts from the sync (the call still exists in funding_calls).
 *
 *   SELECT DISTINCT ON (p.id) p.id AS project_id, m.id AS monitor_id, p.locale
 *     FROM monitors m
 *     JOIN projects p ON p.id = m.project_id AND p.status != 'archived'
 *    WHERE m.type = 'ecosystem.grants'
 *      AND m.status = 'active'
 *    ORDER BY p.id, m.created_at ASC
 */
export async function loadGrantsWatchers(): Promise<GrantsWatcher[]> {
  const rows = await query<{ project_id: string; monitor_id: string; locale: string | null }>(
    `SELECT DISTINCT ON (p.id) p.id AS project_id, m.id AS monitor_id, p.locale
       FROM monitors m
       JOIN projects p ON p.id = m.project_id AND p.status != 'archived'
      WHERE m.type = 'ecosystem.grants'
        AND m.status = 'active'
      ORDER BY p.id, m.created_at ASC`,
  );
  // Same locale rule as ecosystem-monitors.ts (project.locale === 'it' ? 'it' : 'en').
  return rows.map((r) => ({
    project_id: r.project_id,
    monitor_id: r.monitor_id,
    locale: r.locale === 'it' ? 'it' : 'en',
  }));
}

/**
 * Which of `ids` warrant a bounded detail fetch:
 *   - new identifiers and known ones never enriched (no eligibility_text yet);
 *   - ROLLING calls due for re-verification. Only the detail page can say a
 *     sportello has closed (Socrata keeps listing it with a NULL closing date
 *     for up to a year), so every rolling call is re-checked once a week
 *     (deterministic day-of-week bucket by identifier hash, ~1/7 per day) and
 *     EVERY day while it has a pending miss (missed_syncs > 0) so a
 *     'Chiuso' chip reaches the two consecutive misses that close it.
 * The connector caps the count (rolling first). Lookup failure → ask for
 * everything (enrichment is never a gate).
 */
async function needsDetailFor(source: FundingSource, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  try {
    const rows = await query<{ source_identifier: string }>(
      `SELECT source_identifier FROM funding_calls
        WHERE source = ? AND status != 'closed' AND (eligibility_text IS NOT NULL OR page_status = 'ok')
          AND NOT (
            status = 'rolling'
            AND (missed_syncs > 0
                 OR ((hashtext(source_identifier) % 7) + 7) % 7 = EXTRACT(DOW FROM CURRENT_DATE)::int)
          )
          AND source_identifier = ANY(string_to_array(?, E'\\n'))`,
      source,
      ids.join('\n'),
    );
    const enriched = new Set(rows.map((r) => r.source_identifier));
    return new Set(ids.filter((id) => !enriched.has(id)));
  } catch (err) {
    console.warn('[grants] needsDetail lookup failed:', (err as Error).message);
    return new Set(ids);
  }
}

/** SQL fragment selecting projects of one alert locale (NULL locale → 'en', as loadGrantsWatchers). */
function projectLocaleSql(locale: 'en' | 'it'): string {
  return locale === 'it' ? `p.locale = 'it'` : `(p.locale IS NULL OR p.locale <> 'it')`;
}

export async function syncSource(
  connector: SourceConnector,
  opts: { now: Date; force: boolean; fetch?: FetchLike; watchers: GrantsWatcher[] },
): Promise<SourceSyncResult> {
  const { now, force, watchers } = opts;
  const nowIso = now.toISOString();
  const source = connector.source;
  const result = zeroResult(source);

  // 1. Gate — SQL-side, no TZ arithmetic. last_success_at is ONLY advanced by
  //    a sync that returned > 0 rows, so a failed/empty source is retried on
  //    the next tick instead of waiting a day.
  const gate = await get<{ ran_today: boolean }>(
    `SELECT (last_success_at IS NOT NULL AND last_success_at >= CURRENT_DATE) AS ran_today
       FROM funding_source_state WHERE source = ?`,
    source,
  );
  if (!force && gate?.ran_today) {
    return { ...result, skipped_gate: true, ok: true };
  }

  // 2. Fetch — a throw or zero rows records the error and changes NOTHING else.
  let listing: ConnectorResult;
  try {
    listing = await connector.fetchCalls({
      fetch: opts.fetch,
      now,
      needsDetail: (ids) => needsDetailFor(source, ids),
    });
  } catch (err) {
    const msg = (err as Error).message.slice(0, 500);
    console.error(`[grants] ${source} fetch failed:`, msg);
    await run(
      `UPDATE funding_source_state SET last_error = ?, updated_at = ? WHERE source = ?`,
      msg,
      nowIso,
      source,
    );
    return { ...result, ok: false, error: msg };
  }
  const fetched = listing.calls;
  const complete = listing.complete;
  if (fetched.length === 0) {
    console.error(`[grants] ${source} returned 0 calls — recording error, SKIPPING mark-closed`);
    await run(
      `UPDATE funding_source_state SET last_error = ?, last_count = 0, updated_at = ? WHERE source = ?`,
      'zero_results',
      nowIso,
      source,
    );
    return { ...result, ok: false, error: 'zero_results' };
  }

  // Dedupe by source_identifier (last wins) — a connector may legitimately
  // emit the same identifier twice across pages.
  const byId = new Map<string, NormalizedCall>();
  for (const c of fetched) byId.set(c.source_identifier, c);
  const calls = [...byId.values()];

  // 3. Upsert by (source, source_identifier). A known identifier updates
  //    deadline/status/last_verified_at IN PLACE (missed_syncs back to 0,
  //    closed_at cleared) and is NOT `inserted`. `xmax = 0` is true only for
  //    a freshly inserted tuple. The `prev` CTE captures the row as it was
  //    before this statement (same snapshot) so the caller can tell a
  //    reopen (prev closed) and a deadline change apart from a no-op update.
  //    KEEP_PAGE_PARSE_SQL stops a Socrata-only re-sync from overwriting a
  //    detail-page deadline; the hour is kept only when the date is unchanged
  //    so the row never carries a time that belongs to another date.
  const insertedRows: StoredCall[] = [];
  const reopenedRows: StoredCall[] = [];
  const changedRows: StoredCall[] = [];
  for (const call of calls) {
    try {
      const rows = await query<UpsertRow>(
        `WITH prev AS (
           SELECT status, deadline::text AS deadline, deadline_time
             FROM funding_calls
            WHERE source = ? AND source_identifier = ?
         )
         INSERT INTO funding_calls
           (id, source, source_identifier, official_url, title, granting_body, deadline, deadline_time,
            status, eligibility_text, raw_snippet, parse_method, missed_syncs,
            first_seen_at, last_verified_at, closed_at, updated_at,
            page_status, page_error, page_checked_at,
            regions, facets, source_note, catalog_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, ?, ?, ?, ?, ?::text[], ?::jsonb, ?, ?)
         ON CONFLICT (source, source_identifier) DO UPDATE SET
           official_url     = excluded.official_url,
           title            = excluded.title,
           granting_body    = COALESCE(excluded.granting_body, funding_calls.granting_body),
           deadline         = CASE WHEN ${KEEP_PAGE_PARSE_SQL} THEN funding_calls.deadline
                                   ELSE excluded.deadline END,
           deadline_time    = CASE WHEN ${KEEP_PAGE_PARSE_SQL} THEN funding_calls.deadline_time
                                   WHEN excluded.deadline_time IS NOT NULL THEN excluded.deadline_time
                                   WHEN excluded.deadline IS NOT DISTINCT FROM funding_calls.deadline THEN funding_calls.deadline_time
                                   ELSE NULL END,
           status           = CASE WHEN ${KEEP_PAGE_PARSE_SQL} THEN funding_calls.status
                                   ELSE excluded.status END,
           eligibility_text = COALESCE(excluded.eligibility_text, funding_calls.eligibility_text),
           raw_snippet      = CASE WHEN ${KEEP_PAGE_PARSE_SQL} THEN funding_calls.raw_snippet
                                   ELSE excluded.raw_snippet END,
           parse_method     = CASE WHEN ${KEEP_PAGE_PARSE_SQL} THEN funding_calls.parse_method
                                   ELSE excluded.parse_method END,
           missed_syncs     = 0,
           last_verified_at = excluded.last_verified_at,
           closed_at        = NULL,
           updated_at       = excluded.updated_at,
           page_status      = CASE WHEN ${KEEP_PAGE_STATUS_SQL} THEN funding_calls.page_status
                                   ELSE excluded.page_status END,
           page_error       = CASE WHEN ${KEEP_PAGE_STATUS_SQL} THEN funding_calls.page_error
                                   ELSE excluded.page_error END,
           page_checked_at  = CASE WHEN ${KEEP_PAGE_STATUS_SQL} THEN funding_calls.page_checked_at
                                   ELSE excluded.page_checked_at END,
           regions          = excluded.regions,
           facets           = excluded.facets,
           source_note      = excluded.source_note,
           catalog_url      = excluded.catalog_url
         RETURNING id, (xmax = 0) AS inserted,
                   status, deadline::text AS deadline, deadline_time,
                   (SELECT p.status FROM prev p) AS prev_status,
                   (SELECT p.deadline FROM prev p) AS prev_deadline,
                   (SELECT p.deadline_time FROM prev p) AS prev_deadline_time`,
        call.source,
        call.source_identifier,
        generateId('fcall'),
        call.source,
        call.source_identifier,
        call.official_url,
        call.title,
        call.granting_body,
        call.deadline,
        call.deadline_time,
        call.status,
        call.eligibility_text,
        call.raw_snippet,
        call.parse_method,
        nowIso,
        nowIso,
        nowIso,
        call.page_status ?? 'unread',
        call.page_error ?? null,
        (call.page_status ?? 'unread') === 'unread' ? null : nowIso,
        call.regions ?? null,
        // RAW object — postgres.js serialises jsonb params itself; a pre-stringified
        // value gets encoded twice and lands as a JSON *string* (the documented trap).
        call.facets ?? null,
        call.source_note ?? null,
        call.catalog_url ?? null,
      );
      const row = rows[0];
      if (!row) {
        console.warn('[grants] upsert returned no row:', call.source_identifier);
        continue;
      }
      // What the DB holds now (the keep-page-parse guard may have preferred the stored block).
      const stored: NormalizedCall = {
        ...call,
        status: row.status === 'rolling' ? 'rolling' : 'open',
        deadline: row.deadline ?? null,
        deadline_time: row.deadline_time ?? null,
      };
      if (row.inserted) {
        result.inserted++;
        insertedRows.push({ id: row.id, call: stored });
        continue;
      }
      result.updated++;
      if (row.prev_status === 'closed' && row.status !== 'closed') {
        result.reopened++;
        reopenedRows.push({ id: row.id, call: stored });
      } else if (
        (row.prev_deadline ?? null) !== (row.deadline ?? null) ||
        (row.prev_deadline_time ?? null) !== (row.deadline_time ?? null) ||
        row.prev_status !== row.status
      ) {
        changedRows.push({ id: row.id, call: stored });
      }
    } catch (err) {
      console.warn('[grants] upsert failed:', call.source_identifier, (err as Error).message);
    }
  }

  // 4a. Reopen — a call that was closed (expiry / misses) and is listed open
  //     again gets its founder-facing half back: alerts the expiry
  //     auto-dismissed return to pending (founder dismissals are untouched —
  //     they carry founder_action_taken = 'inbox_reject'), and the tickets the
  //     expiry auto-rejected return to pending so materialize-on-read and the
  //     inbox see them again (a second ticket per alert is impossible:
  //     uq_pending_actions_ecosystem_alert).
  for (const { id, call } of reopenedRows) {
    try {
      const alerts = await run(
        `UPDATE ecosystem_alerts
            SET reviewed_state = 'pending', reviewed_at = NULL, founder_action_taken = NULL
          WHERE funding_call_id = ? AND reviewed_state = 'dismissed' AND founder_action_taken = 'auto_expired'`,
        id,
      );
      const tickets = await run(
        `UPDATE pending_actions pa
            SET status = 'pending', execution_result = NULL, updated_at = ?
          WHERE pa.action_type = 'signal_alert'
            AND pa.status = 'rejected'
            AND (pa.execution_result->>'auto_dismissed') = 'true'
            AND pa.ecosystem_alert_id IN (
              SELECT ea.id FROM ecosystem_alerts ea
               WHERE ea.funding_call_id = ? AND ea.reviewed_state = 'pending')`,
        nowIso,
        id,
      );
      console.log(
        `[grants] ${source}: reopened ${call.source_identifier} (${affectedRows(alerts)} alert(s), ${affectedRows(tickets)} ticket(s) back to pending)`,
      );
    } catch (err) {
      console.warn('[grants] reopen failed:', call.source_identifier, (err as Error).message);
    }
  }
  if (reopenedRows.length > 0) console.log(`[grants] ${source}: reopened ${reopenedRows.length} call(s)`);

  // 4b. Refresh — the headline is the deadline the founder reads, so when the
  //     stored deadline/time/status changed (proroga, shortening, rolling →
  //     dated) every still-pending alert and its pending ticket are rewritten
  //     in the project's locale. dedupe_hash is left alone: the parsed alerts
  //     are unique per (project, funding_call_id), and rehashing could only
  //     collide with the (project, dedupe_hash) unique index.
  for (const { id, call } of [...reopenedRows, ...changedRows]) {
    for (const locale of ['it', 'en'] as const) {
      try {
        const { headline, body } = buildGrantAlertContent(call, locale, now);
        const refreshed = await run(
          `UPDATE ecosystem_alerts ea
              SET headline = ?, body = ?
             FROM projects p
            WHERE p.id = ea.project_id
              AND ea.funding_call_id = ?
              AND ea.reviewed_state = 'pending'
              AND ${projectLocaleSql(locale)}`,
          headline,
          body,
          id,
        );
        result.alerts_refreshed += affectedRows(refreshed);
        await run(
          `UPDATE pending_actions pa
              SET title = ?, rationale = ?, updated_at = ?
             FROM ecosystem_alerts ea
             JOIN projects p ON p.id = ea.project_id
            WHERE pa.ecosystem_alert_id = ea.id
              AND ea.funding_call_id = ?
              AND pa.action_type = 'signal_alert'
              AND pa.status = 'pending'
              AND ${projectLocaleSql(locale)}`,
          headline,
          body.slice(0, 500),
          nowIso,
          id,
        );
      } catch (err) {
        console.warn('[grants] alert refresh failed:', call.source_identifier, locale, (err as Error).message);
      }
    }
  }
  if (changedRows.length > 0) {
    console.log(
      `[grants] ${source}: deadline/status changed for ${changedRows.length} call(s) — ${result.alerts_refreshed} pending alert(s) rewritten`,
    );
  }

  // 4c. Alerts — exactly ONE per (project, call) for every NEW call (and for
  //     every REOPENED call, for watchers that never had one), for every
  //     project with an active grants monitor (see loadGrantsWatchers). The
  //     bare ON CONFLICT DO NOTHING absorbs both UNIQUE(project_id, dedupe_hash)
  //     and the partial unique index uq_ecosystem_alerts_project_funding_call.
  //     relevance_score 0.7 sits below the 0.8 auto-queue threshold on purpose:
  //     the inbox materializes a signal_alert ticket on the next read like any
  //     other pending alert. entity is NULL on purpose: the SIGNAL_AUTOFLOW
  //     router files an alert whose entity matches an existing graph node as
  //     'enrich' (no inbox ticket), and the granting body ('Horizon Europe')
  //     would match after the first accepted grant — every later call from
  //     that body would vanish from the inbox.
  if (watchers.length > 0) {
    for (const { id: fundingCallId, call } of [...insertedRows, ...reopenedRows]) {
      for (const w of watchers) {
        try {
          const { headline, body } = buildGrantAlertContent(call, w.locale, now);
          const rows = await query<{ id: string }>(
            `INSERT INTO ecosystem_alerts
               (id, project_id, monitor_id, monitor_run_id, alert_type, source, source_url,
                headline, body, relevance_score, confidence, dedupe_hash, entity,
                reviewed_state, funding_call_id, created_at)
             VALUES (?, ?, ?, NULL, 'funding_event', ?, ?, ?, ?, 0.7, 0.9, ?, NULL, 'pending', ?, ?)
             ON CONFLICT DO NOTHING
             RETURNING id`,
            generateId('ealr'),
            w.project_id,
            w.monitor_id,
            `grants:${call.source}`,
            call.official_url,
            headline,
            body,
            computeDedupeHash('funding_event', call.official_url, headline),
            fundingCallId,
            nowIso,
          );
          if (rows.length > 0) result.alerts_created++;
        } catch (err) {
          console.warn('[grants] alert insert failed:', (err as Error).message);
        }
      }
    }
  }

  // 5. Mark missing — ONLY on a successful, non-empty, COMPLETE listing. One
  //    miss is tolerated (a flaky page); the second consecutive miss closes.
  //    A truncated listing (page cap / row limit) proves nothing about the
  //    calls it could not carry, so this step is skipped for that run.
  if (!complete) {
    result.partial = true;
    console.warn(
      `[grants] ${source}: listing INCOMPLETE (connector truncated at ${calls.length} call(s)) — mark-missing SKIPPED, nothing closed this run`,
    );
  } else {
    const seenIds = calls.map((c) => c.source_identifier).join('\n');
    await run(
      `UPDATE funding_calls
          SET missed_syncs = missed_syncs + 1, updated_at = ?
        WHERE source = ? AND status IN ('open', 'rolling')
          AND NOT (source_identifier = ANY(string_to_array(?, E'\\n')))`,
      nowIso,
      source,
      seenIds,
    );
    const closedResult = await run(
      `UPDATE funding_calls
          SET status = 'closed', closed_at = ?, updated_at = ?
        WHERE source = ? AND status IN ('open', 'rolling') AND missed_syncs >= 2`,
      nowIso,
      nowIso,
      source,
    );
    result.closed_missing = affectedRows(closedResult);
    if (result.closed_missing > 0) {
      console.log(`[grants] ${source}: closed ${result.closed_missing} call(s) missing for 2 consecutive syncs`);
    }
  }

  // 6. State — the only place last_success_at advances. A partial listing is
  //    still a success for the gate (its rows were upserted; retrying within
  //    the day would truncate the same way) but leaves a trace in last_error
  //    so the cron summary shows it.
  await run(
    `INSERT INTO funding_source_state (source, last_success_at, last_error, last_count, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (source) DO UPDATE SET
       last_success_at = excluded.last_success_at, last_error = excluded.last_error,
       last_count = excluded.last_count, updated_at = excluded.updated_at`,
    source,
    nowIso,
    complete ? null : `truncated: ${calls.length} call(s) fetched, listing incomplete`,
    calls.length,
    nowIso,
  );
  result.fetched = calls.length;
  result.ok = true;
  return result;
}

/**
 * Daily expiry — mirrors dismissStaleNotifications in src/app/api/cron/route.ts
 * (bulk UPDATE, count via `.count`, log only when > 0):
 *   1. open calls whose deadline < CURRENT_DATE become closed (closed_at set);
 *   2. pending funding_event alerts whose call is closed are auto-dismissed;
 *   3. their signal_alert tickets are rejected with the cron's auto-dismiss
 *      convention, verbatim from route.ts:
 *        SET status = 'rejected',
 *            updated_at = ?,
 *            execution_result = COALESCE(pa.execution_result, '{"auto_dismissed":true,"reason":"…"}')
 *        WHERE pa.status IN ('pending', 'edited') AND pa.action_type = '…'
 */
export async function expireFundingCalls(now: Date): Promise<{ expired: number; alerts_dismissed: number }> {
  const nowIso = now.toISOString();

  const expiredResult = await run(
    `UPDATE funding_calls SET status = 'closed', closed_at = ?, updated_at = ?
      WHERE status = 'open' AND deadline IS NOT NULL AND deadline < CURRENT_DATE`,
    nowIso,
    nowIso,
  );
  const expired = affectedRows(expiredResult);
  if (expired > 0) console.log(`[grants] expired ${expired} past-deadline call(s)`);

  const dismissedResult = await run(
    `UPDATE ecosystem_alerts ea
        SET reviewed_state = 'dismissed', reviewed_at = ?, founder_action_taken = 'auto_expired'
      WHERE ea.reviewed_state = 'pending'
        AND ea.funding_call_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM funding_calls fc WHERE fc.id = ea.funding_call_id AND fc.status = 'closed')`,
    nowIso,
  );
  const alertsDismissed = affectedRows(dismissedResult);

  const ticketResult = await run(
    `UPDATE pending_actions pa
        SET status = 'rejected',
            updated_at = ?,
            execution_result = COALESCE(pa.execution_result, '{"auto_dismissed":true,"reason":"funding call closed"}')
      WHERE pa.status IN ('pending', 'edited')
        AND pa.action_type = 'signal_alert'
        AND pa.ecosystem_alert_id IN (
          SELECT ea.id FROM ecosystem_alerts ea
            JOIN funding_calls fc ON fc.id = ea.funding_call_id
           WHERE fc.status = 'closed')`,
    nowIso,
  );
  const ticketsDismissed = affectedRows(ticketResult);
  if (alertsDismissed > 0 || ticketsDismissed > 0) {
    console.log(
      `[grants] auto-dismissed ${alertsDismissed} alert(s) and ${ticketsDismissed} ticket(s) for closed call(s)`,
    );
  }

  return { expired, alerts_dismissed: alertsDismissed };
}

/** Cut to `max` chars with a trailing ellipsis (result length <= max). */
function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/**
 * Localized alert text. The headline ALWAYS carries the deadline as
 * DD/MM/YYYY (it) or YYYY-MM-DD (en) so it also passes the legacy headline
 * date gate in ecosystem-alert-parser if it ever flows through it, and stays
 * ≤ 300 chars (the legacy validateAlert invariant). The 300-char budget is
 * taken out of the TITLE (granting body capped at 120), never off the tail:
 * a long title + DG name must not truncate the one thing the founder plans
 * around.
 */
export function buildGrantAlertContent(
  call: AlertCallInput,
  locale: 'en' | 'it',
  verifiedAt: Date,
): { headline: string; body: string } {
  const bodyText = clip((call.granting_body ?? translate(locale, 'grants.alert.body-unknown')).trim(), GRANTING_BODY_MAX);
  const deadline =
    call.status === 'rolling' || !call.deadline
      ? translate(locale, 'grants.alert.rolling')
      : formatDeadlineForLocale(call.deadline, locale) + (call.deadline_time ? ` ${call.deadline_time}` : '');
  const assemble = (title: string): string =>
    translate(locale, 'grants.alert.headline', { title, body: bodyText, deadline });

  let title = clip(call.title.trim(), TITLE_MAX);
  let headline = assemble(title);
  // Shrink the title by exactly the overflow (clip yields <= the requested
  // length, so one pass suffices; the loop is a guard, never a hot path).
  while (headline.length > HEADLINE_MAX && title.length > 1) {
    title = clip(title, Math.max(1, title.length - (headline.length - HEADLINE_MAX)));
    headline = assemble(title);
  }

  const eligibility = call.eligibility_text
    ? excerpt(call.eligibility_text, 600)
    : translate(locale, 'grants.alert.no-eligibility');
  const body = translate(locale, 'grants.alert.body', {
    eligibility,
    verified: formatDeadlineForLocale(toDateOnly(verifiedAt), locale),
  });
  return { headline, body };
}
