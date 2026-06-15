'use client';

/**
 * WatcherListPanel (filename still MonitorListPanel.tsx + export
 * preserved for backward compat with existing imports).
 *
 * Founder-facing list of "watchers" — the unified primitive over the two
 * underlying implementations: LLM-scan (the `monitors` table) and URL-diff
 * (the `watch_sources` table). The founder sees ONE concept; the row's type
 * pill ("Topic" or "URL") names the flavor without leaking the table split.
 *
 * Two render modes, driven by the `compact` prop:
 *   - compact: bare rows only (rendered INSIDE an existing Panel on /today,
 *     capped by `limit`, no title, no CTA). Rows link into the Inbox's
 *     Watchers tab with ?watcher=<id> so the clicked row opens expanded.
 *   - full: own heading + "+ New watcher" CTA + own scroll (/actions lane).
 *     Rows EXPAND IN PLACE — the old standalone /monitors/[monitorId] detail
 *     page was folded into this panel (one surface, no nested page). The
 *     expanded body lazy-fetches the same detail endpoint that page used:
 *     GET /api/projects/:projectId/monitors/:monitorId — objective, schedule,
 *     next/last run, last-run summary + sources. Actions reuse the existing
 *     endpoints: PATCH .../monitors/:id {status} (pause/resume, same call as
 *     CronSettingsPanel) and POST .../monitors/:id/run (manual run). There is
 *     no DELETE endpoint, so no delete verb here.
 *
 * Data: GET /api/projects/:projectId/watchers — unified read endpoint over
 * monitors + watch_sources. Proposed-not-yet-approved watchers live in the
 * inbox (configure_monitor / configure_watch_source pending_actions) — out
 * of this panel's scope.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Pill, Icon, I } from '@/components/design/primitives';
import type { Watcher } from '@/lib/watchers';
import NewWatcherForm from '@/components/monitors/NewWatcherForm';
import { useT } from '@/components/providers/LocaleProvider';
import type { MessageKey, TranslateVars } from '@/lib/i18n/messages';

type TFn = (key: MessageKey, vars?: TranslateVars) => string;

function relAge(iso: string | null, t: TFn): string {
  if (!iso) return t('monitors.never-run');
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return t('monitors.just-now');
  if (mins < 60) return t('monitors.age-minutes', { n: mins });
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return t('monitors.age-hours', { n: hrs });
  const days = Math.round(hrs / 24);
  if (days < 7) return t('monitors.age-days', { n: days });
  return t('monitors.age-weeks', { n: Math.round(days / 7) });
}

function relFuture(iso: string | null, t: TFn): string {
  if (!iso) return '—';
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return '—';
  if (ms < 0) return t('monitors.overdue');
  const m = Math.floor(ms / 60_000);
  if (m < 60) return t('monitors.in-minutes', { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('monitors.in-hours', { n: h });
  return t('monitors.in-days', { n: Math.floor(h / 24) });
}

function statusPill(status: string, t: TFn) {
  if (status === 'active') return <Pill kind="ok" dot>{t('monitors.status-active')}</Pill>;
  if (status === 'paused') return <Pill kind="n">{t('monitors.status-paused')}</Pill>;
  if (status === 'error') return <Pill kind="warn">{t('monitors.status-error')}</Pill>;
  if (status === 'archived') return <Pill kind="n">{t('monitors.status-archived')}</Pill>;
  return <Pill kind="n">{status}</Pill>;
}

/** Iter-3.5: founder-facing type pill. "URL" = watch_source (URL diff),
 *  "Topic" = monitor (LLM scan). Hides the implementation detail behind a
 *  single-word label that explains what's being watched without naming
 *  which table it lives in. */
function kindPill(kind: string, t: TFn) {
  if (kind === 'diff') return <Pill kind="n">{t('monitors.kind-url')}</Pill>;
  if (kind === 'scan') return <Pill kind="n">{t('monitors.kind-topic')}</Pill>;
  if (kind === 'hybrid') return <Pill kind="n">{t('monitors.kind-mixed')}</Pill>;
  return null;
}

// =============================================================================
// Detail payload — subset of GET /api/projects/:id/monitors/:monitorId
// (the endpoint that powered the retired /monitors/[monitorId] page).
// =============================================================================

interface MonitorRunLite {
  id: string;
  status: string;
  summary: string | null;
  alerts_generated: number;
  run_at: string;
  trigger_type: string;
}

interface MonitorDetailLite {
  monitor: {
    id: string;
    name: string;
    objective: string | null;
    prompt: string | null;
    schedule: string;
    status: string;
    last_run: string | null;
    next_run: string | null;
  };
  last_run: MonitorRunLite | null;
  last_run_sources: string[];
  // Run history (newest-first), surfaced as the collapsible "Logs" subsection.
  // The detail endpoint honors ?runs_limit=N (max 200); we ask for 20.
  recent_runs: MonitorRunLite[];
}

// =============================================================================
// Live run stream — one entry per agent step (tool call) + the streamed prose.
// The run route forwards pi-agent's SSE frames verbatim:
//   { content }                  — prose delta (reasoning / synthesis)
//   { tool_start: { name, args } } — a web search / page read began
//   { tool_end:   { name, error } } — that step finished
//   { done, ecosystem_alerts_inserted } — final frame (route-enriched)
//   { error }                    — failure
// We turn tool_start/tool_end into a readable activity feed and stream the
// prose live, so the founder watches the watcher think instead of staring at
// a frozen "Running…".
// =============================================================================

type RunStepStatus = 'running' | 'done' | 'error';
interface RunStep {
  id: string;
  label: string;
  status: RunStepStatus;
}

/** Founder-readable label for an agent tool call. */
function toolStepLabel(name: string, args: unknown, t: TFn): string {
  const a = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  if (name === 'web_search') {
    const q = str(a.query) || str(a.q) || str(a.search);
    return q ? t('monitors.step-searching-query', { query: q }) : t('monitors.step-searching');
  }
  if (name === 'read_url' || name === 'fetch_url' || name === 'read_page') {
    const u = str(a.url) || str(a.href);
    return u ? t('monitors.step-reading-host', { host: prettyHost(u) }) : t('monitors.step-reading-page');
  }
  if (name === 'calculate') return t('monitors.step-calculating');
  return name.replace(/_/g, ' ');
}

function prettyHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.length > 48 ? `${url.slice(0, 48)}…` : url;
  }
}

/** Strip emitted alert artifacts from streamed prose — both closed
 *  `:::artifact … :::` blocks and an unterminated trailing one (the stream
 *  may cut mid-artifact). Leaves the founder-facing reasoning prose. */
function stripArtifactsLive(text: string): string {
  return text
    .replace(/:::artifact[\s\S]*?:::/g, '')
    .replace(/:::artifact[\s\S]*$/g, '')
    .trim();
}

// =============================================================================
// Rows
// =============================================================================

/** Compact mode (/today): plain link into the Inbox Watchers tab, carrying
 *  ?watcher=<origin id> so the clicked row arrives pre-expanded. */
function CompactWatcherRow({ projectId, w }: { projectId: string; w: Watcher }) {
  const href = `/project/${projectId}/actions?lane=monitor&watcher=${w._origin_id}`;
  return (
    <Link
      href={href}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '10px 12px',
        borderRadius: 6,
        textDecoration: 'none',
        color: 'inherit',
        transition: 'background .1s',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--paper-2)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <RowHeader w={w} />
    </Link>
  );
}

function RowHeader({ w, expanded }: { w: Watcher; expanded?: boolean }) {
  const t = useT();
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
      {expanded !== undefined && (
        <Icon
          d={I.chevr}
          size={9}
          style={{
            color: 'var(--ink-5)',
            flexShrink: 0,
            marginTop: 4,
            transform: expanded ? 'rotate(90deg)' : 'none',
            transition: 'transform .12s',
          }}
        />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {w.name}
          </span>
          {kindPill(w.kind, t)}
          {statusPill(w.status, t)}
        </div>
        <div
          className="lp-mono"
          style={{ fontSize: 10, color: 'var(--ink-5)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
        >
          <span>{w.cadence}</span>
          <span>· {relAge(w.last_run_at, t)}</span>
        </div>
      </div>
    </div>
  );
}

/** Full mode: click toggles an in-place detail body (the merged-in monitor
 *  detail page). Detail is lazy-fetched only on first expand. */
function ExpandableWatcherRow({
  projectId,
  w,
  expanded,
  onToggle,
}: {
  projectId: string;
  w: Watcher;
  expanded: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const isMonitor = w._origin === 'monitor';

  // Same fetch the retired /monitors/[monitorId] page did. runs_limit=20 so
  // the expanded body can render both the prominent latest-run summary AND the
  // collapsible "Logs" history (recent_runs, newest-first) below it.
  const { data: detail, isLoading, isError } = useQuery<MonitorDetailLite>({
    queryKey: ['watcher-detail', projectId, w._origin_id],
    enabled: expanded && isMonitor,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/monitors/${w._origin_id}?runs_limit=20`);
      const body = await res.json();
      if (!res.ok || !body?.success) throw new Error(body?.error || `HTTP ${res.status}`);
      return body.data as MonitorDetailLite;
    },
  });

  const [busy, setBusy] = useState<'run' | 'status' | 'save' | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);

  // Live-run state: the activity feed + streamed prose + final outcome.
  const [runSteps, setRunSteps] = useState<RunStep[]>([]);
  const [runText, setRunText] = useState('');
  const [runDone, setRunDone] = useState<{ alerts: number } | null>(null);
  const [runErr, setRunErr] = useState<string | null>(null);

  // Inline edit state for name / prompt / cadence.
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPrompt, setEditPrompt] = useState('');
  const [editCadence, setEditCadence] = useState('weekly');

  // "Logs" subsection: the run-history list. Collapsed by default; `openRunId`
  // tracks which single log row has its summary revealed.
  const [logsOpen, setLogsOpen] = useState(false);
  const [openRunId, setOpenRunId] = useState<string | null>(null);

  async function invalidate() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['watchers', projectId] }),
      qc.invalidateQueries({ queryKey: ['watcher-detail', projectId, w._origin_id] }),
    ]);
  }

  // Pause / resume — same PATCH CronSettingsPanel issues.
  async function setStatus(next: 'active' | 'paused') {
    if (busy) return;
    setBusy('status');
    setActionErr(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/monitors/${w._origin_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      const body = await res.json();
      if (!res.ok || !body?.success) throw new Error(body?.error || `HTTP ${res.status}`);
    } catch (e) {
      setActionErr((e as Error).message || t('monitors.update-failed'));
    } finally {
      setBusy(null);
      void invalidate();
    }
  }

  // Manual run — POST .../run streams SSE. Instead of silently draining the
  // stream, read it frame-by-frame and surface the watcher's live activity:
  // each tool call becomes a step in the feed, the prose streams in, and the
  // final frame reports how many signals landed. This is the "show me what's
  // happening" view.
  async function runNow() {
    if (busy) return;
    setBusy('run');
    setActionErr(null);
    setRunErr(null);
    setRunSteps([]);
    setRunText('');
    setRunDone(null);
    try {
      // Content-Type: application/json is REQUIRED — the CSRF middleware
      // (src/middleware.ts) rejects mutating /api/* calls without it (415,
      // and a 404 against an earlier stale build).
      const res = await fetch(`/api/projects/${projectId}/monitors/${w._origin_id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let streaming = true;
      while (streaming) {
        const { done, value } = await reader.read();
        if (done) { streaming = false; break; }
        buf += decoder.decode(value, { stream: true });
        // SSE frames are newline-delimited `data: {...}` lines; keep the last
        // (possibly partial) line in the buffer for the next chunk.
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let frame: Record<string, unknown>;
          try {
            frame = JSON.parse(line.slice(6));
          } catch {
            continue;
          }
          handleRunFrame(frame);
        }
      }
    } catch (e) {
      setRunErr((e as Error).message || t('monitors.run-failed'));
      setActionErr((e as Error).message || t('monitors.run-failed'));
    } finally {
      setBusy(null);
      void invalidate();
    }
  }

  // Apply one SSE frame to the live-run state.
  function handleRunFrame(frame: Record<string, unknown>) {
    if (typeof frame.content === 'string') {
      setRunText((t) => t + (frame.content as string));
      return;
    }
    if (frame.tool_start && typeof frame.tool_start === 'object') {
      const ts = frame.tool_start as { id?: string; name?: string; args?: unknown };
      const id = ts.id || `${ts.name}-${Date.now()}`;
      setRunSteps((s) => [
        ...s,
        { id, label: toolStepLabel(ts.name || 'step', ts.args, t), status: 'running' },
      ]);
      return;
    }
    if (frame.tool_end && typeof frame.tool_end === 'object') {
      const te = frame.tool_end as { id?: string; error?: boolean };
      setRunSteps((s) =>
        s.map((step) =>
          step.id === te.id ? { ...step, status: te.error ? 'error' : 'done' } : step,
        ),
      );
      return;
    }
    if (frame.error) {
      setRunErr(String(frame.error));
      return;
    }
    if (frame.done === true) {
      // pi-agent's own done frame has no alert count; the route's enriched
      // done frame carries ecosystem_alerts_inserted. The latter arrives
      // last, so it wins.
      const alerts =
        typeof frame.ecosystem_alerts_inserted === 'number'
          ? frame.ecosystem_alerts_inserted
          : 0;
      setRunSteps((s) => s.map((step) => (step.status === 'running' ? { ...step, status: 'done' } : step)));
      setRunDone({ alerts });
    }
  }

  function beginEdit() {
    setEditName(detail?.monitor.name ?? w.name);
    setEditPrompt(detail?.monitor.prompt ?? detail?.monitor.objective ?? '');
    setEditCadence(detail?.monitor.schedule ?? w.cadence ?? 'weekly');
    setActionErr(null);
    setEditing(true);
  }

  // Save name / prompt / cadence. The prompt is written to `prompt` (what the
  // agent runs) AND `objective` (what the detail renders) so an edit visibly
  // sticks — see the PATCH route.
  async function saveEdit() {
    if (busy) return;
    const name = editName.trim();
    if (!name) { setActionErr(t('monitors.name-required')); return; }
    setBusy('save');
    setActionErr(null);
    try {
      const prompt = editPrompt.trim();
      const res = await fetch(`/api/projects/${projectId}/monitors/${w._origin_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, prompt, objective: prompt, schedule: editCadence }),
      });
      const body = await res.json();
      if (!res.ok || !body?.success) throw new Error(body?.error || `HTTP ${res.status}`);
      setEditing(false);
    } catch (e) {
      setActionErr((e as Error).message || t('monitors.save-failed'));
    } finally {
      setBusy(null);
      void invalidate();
    }
  }

  const liveStatus = detail?.monitor?.status ?? w.status;
  const summary = detail?.last_run?.summary?.trim() || '';
  const summaryExcerpt = summary.length > 360 ? `${summary.slice(0, 360)}…` : summary;
  // Run history for the Logs subsection (already ordered newest-first).
  const recentRuns = detail?.recent_runs ?? [];

  return (
    <div
      id={`watcher-${w._origin_id}`}
      style={{
        border: expanded ? '1px solid var(--line)' : '1px solid transparent',
        borderRadius: 6,
        background: expanded ? 'var(--surface)' : 'transparent',
        marginBottom: expanded ? 6 : 0,
      }}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
          padding: '10px 12px',
          borderRadius: 6,
          cursor: 'pointer',
          transition: 'background .1s',
        }}
        onMouseEnter={(e) => { if (!expanded) e.currentTarget.style.background = 'var(--paper-2)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        <RowHeader w={w} expanded={expanded} />
      </div>

      {expanded && (
        <div style={{ borderTop: '1px solid var(--line)', padding: '12px 14px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {isMonitor ? (
            isLoading && !detail ? (
              <div className="lp-mono" style={{ fontSize: 11, color: 'var(--ink-5)' }}>{t('monitors.loading-detail')}</div>
            ) : isError ? (
              <div style={{ fontSize: 12, color: 'var(--clay)' }}>{t('monitors.detail-load-error')}</div>
            ) : detail ? (
              <>
                {/* Prompt — what the watcher is asked each run. Labeled + editable
                    (the founder writes this; previously it rendered as an
                    unlabeled grey sentence with no way to change it). */}
                {editing ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--paper-2)', borderRadius: 6, padding: 10 }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span className="lp-mono" style={editLabelStyle}>{t('monitors.field-name')}</span>
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        style={editInputStyle}
                      />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span className="lp-mono" style={editLabelStyle}>{t('monitors.field-prompt')}</span>
                      <textarea
                        value={editPrompt}
                        onChange={(e) => setEditPrompt(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        rows={3}
                        placeholder={t('monitors.prompt-placeholder')}
                        style={{ ...editInputStyle, resize: 'vertical', lineHeight: 1.5 }}
                      />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 160 }}>
                      <span className="lp-mono" style={editLabelStyle}>{t('monitors.field-cadence')}</span>
                      <select
                        value={editCadence}
                        onChange={(e) => setEditCadence(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        style={editInputStyle}
                      >
                        <option value="daily">{t('monitors.cadence-daily')}</option>
                        <option value="weekly">{t('monitors.cadence-weekly')}</option>
                        <option value="monthly">{t('monitors.cadence-monthly')}</option>
                      </select>
                    </label>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={(e) => { e.stopPropagation(); void saveEdit(); }}
                        style={{ ...miniBtn, background: 'var(--moss)', color: 'var(--paper)', border: 'none', opacity: busy ? 0.6 : 1 }}
                      >
                        {busy === 'save' ? t('monitors.saving') : t('common.save')}
                      </button>
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={(e) => { e.stopPropagation(); setEditing(false); setActionErr(null); }}
                        style={miniBtn}
                      >
                        {t('common.cancel')}
                      </button>
                      {actionErr && <span style={{ fontSize: 11, color: 'var(--clay)' }}>{actionErr}</span>}
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 3 }}>
                      <span className="lp-mono" style={editLabelStyle}>{t('monitors.field-prompt')}</span>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); beginEdit(); }}
                        style={{ fontSize: 10.5, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'var(--f-sans)' }}
                      >
                        {t('common.edit')}
                      </button>
                    </div>
                    <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>
                      {(detail.monitor.prompt || detail.monitor.objective)?.trim() || (
                        <span style={{ color: 'var(--ink-5)', fontStyle: 'italic' }}>
                          {t('monitors.no-prompt-set')}
                        </span>
                      )}
                    </p>
                  </div>
                )}

                <div className="lp-mono" style={{ fontSize: 10.5, color: 'var(--ink-5)', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                  <span>{t('monitors.meta-schedule')} · {detail.monitor.schedule}</span>
                  <span>{t('monitors.meta-last-run')} · {detail.monitor.last_run ? relAge(detail.monitor.last_run, t) : t('monitors.never')}</span>
                  <span>{t('monitors.meta-next-run')} · {relFuture(detail.monitor.next_run, t)}</span>
                </div>

                {(busy === 'run' || runSteps.length > 0 || runText || runDone || runErr) && (
                  <LiveRunPanel
                    running={busy === 'run'}
                    steps={runSteps}
                    text={runText}
                    done={runDone}
                    error={runErr}
                    projectId={projectId}
                  />
                )}

                {detail.last_run ? (
                  <div style={{ background: 'var(--paper-2)', borderRadius: 6, padding: '8px 10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: summaryExcerpt ? 5 : 0 }}>
                      <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>
                        {new Date(detail.last_run.run_at).toLocaleString()}
                      </span>
                      <Pill kind={detail.last_run.status === 'completed' ? 'ok' : detail.last_run.status === 'failed' ? 'warn' : 'n'}>
                        {detail.last_run.status}
                      </Pill>
                      <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>
                        {detail.last_run.alerts_generated === 1
                          ? t('monitors.alert-count-one', { n: detail.last_run.alerts_generated })
                          : t('monitors.alert-count-other', { n: detail.last_run.alerts_generated })}
                      </span>
                    </div>
                    {summaryExcerpt && (
                      <p style={{ margin: 0, fontSize: 11.5, color: 'var(--ink-4)', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {summaryExcerpt}
                      </p>
                    )}
                  </div>
                ) : (
                  <div style={{ fontSize: 11.5, color: 'var(--ink-5)', fontStyle: 'italic' }}>
                    {t('monitors.no-runs-yet-detail')}
                  </div>
                )}

                {/* Logs — the full run history as a collapsible subsection. The
                    latest run stays highlighted above; this is every run, each
                    row previewing its date+time, status and alert count, and
                    expanding to reveal that run's summary. */}
                {recentRuns.length === 0 ? (
                  <div className="lp-mono" style={{ fontSize: 11, color: 'var(--ink-5)' }}>{t('monitors.no-runs-yet')}</div>
                ) : (
                  <div>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setLogsOpen((o) => !o); }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        cursor: 'pointer',
                        fontFamily: 'var(--f-sans)',
                      }}
                    >
                      <Icon
                        d={I.chevr}
                        size={9}
                        style={{
                          color: 'var(--ink-5)',
                          flexShrink: 0,
                          transform: logsOpen ? 'rotate(90deg)' : 'none',
                          transition: 'transform .12s',
                        }}
                      />
                      <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                        {t('monitors.logs-count', { n: recentRuns.length })}
                      </span>
                    </button>

                    {logsOpen && (
                      <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {recentRuns.map((run) => {
                          const runSummary = run.summary?.trim() || '';
                          const runExcerpt = runSummary.length > 400 ? `${runSummary.slice(0, 400)}…` : runSummary;
                          const isOpen = openRunId === run.id;
                          return (
                            <li key={run.id} style={{ background: 'var(--paper-2)', borderRadius: 6 }}>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setOpenRunId((cur) => (cur === run.id ? null : run.id)); }}
                                style={{
                                  width: '100%',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 8,
                                  padding: '6px 10px',
                                  background: 'none',
                                  border: 'none',
                                  cursor: 'pointer',
                                  textAlign: 'left',
                                  fontFamily: 'var(--f-sans)',
                                }}
                              >
                                <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)', flex: 1, minWidth: 0 }}>
                                  {new Date(run.run_at).toLocaleString()}
                                </span>
                                <Pill kind={run.status === 'completed' ? 'ok' : run.status === 'failed' ? 'warn' : 'n'}>
                                  {run.status}
                                </Pill>
                                <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>
                                  {run.alerts_generated === 1
                                    ? t('monitors.alert-count-one', { n: run.alerts_generated })
                                    : t('monitors.alert-count-other', { n: run.alerts_generated })}
                                </span>
                              </button>
                              {isOpen && runExcerpt && (
                                <p style={{ margin: 0, padding: '0 10px 8px', fontSize: 11.5, color: 'var(--ink-4)', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                  {runExcerpt}
                                </p>
                              )}
                              {isOpen && !runExcerpt && (
                                <p style={{ margin: 0, padding: '0 10px 8px', fontSize: 11.5, color: 'var(--ink-5)', fontStyle: 'italic' }}>
                                  {t('monitors.no-summary')}
                                </p>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}

                {detail.last_run_sources.length > 0 && (
                  <div>
                    <div className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>
                      {t('monitors.sources-of-last-run')}
                    </div>
                    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {detail.last_run_sources.slice(0, 6).map((u) => (
                        <li key={u} style={{ fontSize: 11.5, wordBreak: 'break-all' }}>
                          <a href={u} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
                            {u}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    type="button"
                    disabled={busy !== null || liveStatus === 'paused'}
                    onClick={(e) => { e.stopPropagation(); void runNow(); }}
                    style={{ ...miniBtn, opacity: busy || liveStatus === 'paused' ? 0.55 : 1 }}
                    title={liveStatus === 'paused' ? t('monitors.run-resume-hint') : t('monitors.run-now-hint')}
                  >
                    {busy === 'run' ? t('monitors.running') : t('monitors.run-now')}
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={(e) => { e.stopPropagation(); void setStatus(liveStatus === 'paused' ? 'active' : 'paused'); }}
                    style={{ ...miniBtn, opacity: busy ? 0.55 : 1 }}
                  >
                    {busy === 'status' ? t('monitors.saving') : liveStatus === 'paused' ? t('monitors.resume') : t('monitors.pause')}
                  </button>
                  {actionErr && <span style={{ fontSize: 11, color: 'var(--clay)' }}>{actionErr}</span>}
                </div>
              </>
            ) : null
          ) : (
            // watch_source origin: no detail endpoint — render what the
            // unified Watcher row already carries.
            <>
              <div className="lp-mono" style={{ fontSize: 10.5, color: 'var(--ink-5)', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                <span>{t('monitors.meta-schedule')} · {w.cadence}</span>
                <span>{t('monitors.meta-last-run')} · {relAge(w.last_run_at, t)}</span>
                <span>{t('monitors.meta-next-run')} · {relFuture(w.next_run_at, t)}</span>
              </div>
              {(w.inputs.urls ?? []).length > 0 && (
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {(w.inputs.urls ?? []).map((u) => (
                    <li key={u} style={{ fontSize: 11.5, wordBreak: 'break-all' }}>
                      <a href={u} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
                        {u}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              <div style={{ fontSize: 11, color: 'var(--ink-5)', fontStyle: 'italic' }}>
                {t('monitors.url-watcher-note')}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const miniBtn: React.CSSProperties = {
  fontSize: 11,
  padding: '4px 10px',
  borderRadius: 6,
  border: '1px solid var(--line)',
  background: 'transparent',
  color: 'var(--ink-2)',
  cursor: 'pointer',
  fontFamily: 'var(--f-sans)',
};

const editLabelStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--ink-5)',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
};

const editInputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '6px 8px',
  fontSize: 12,
  borderRadius: 6,
  border: '1px solid var(--line-2)',
  background: 'var(--paper)',
  color: 'var(--ink-2)',
  fontFamily: 'var(--f-sans)',
  outline: 'none',
};

// =============================================================================
// LiveRunPanel — the "show me what's happening" view during a manual run.
// Renders the agent's tool calls as a step feed and streams its reasoning
// prose live, then reports the signal count.
// =============================================================================

function StepGlyph({ status }: { status: RunStepStatus }) {
  if (status === 'done') return <span style={{ color: 'var(--moss)', flexShrink: 0 }}>✓</span>;
  if (status === 'error') return <span style={{ color: 'var(--clay)', flexShrink: 0 }}>✗</span>;
  return <span style={{ color: 'var(--accent)', flexShrink: 0 }}>○</span>;
}

function LiveRunPanel({
  running,
  steps,
  text,
  done,
  error,
  projectId,
}: {
  running: boolean;
  steps: RunStep[];
  text: string;
  done: { alerts: number } | null;
  error: string | null;
  projectId: string;
}) {
  const t = useT();
  const proseRef = useRef<HTMLDivElement | null>(null);
  const clean = stripArtifactsLive(text);
  // Keep the streaming prose pinned to the latest token.
  useEffect(() => {
    const el = proseRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [clean]);

  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 6, background: 'var(--paper-2)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)', textTransform: 'uppercase', letterSpacing: 0.4, flex: 1 }}>
          {t('monitors.run-activity')}
        </span>
        {running ? (
          <Pill kind="live" dot>{t('monitors.run-running')}</Pill>
        ) : error ? (
          <Pill kind="warn">{t('monitors.run-failed-pill')}</Pill>
        ) : done ? (
          <Pill kind="ok" dot>{t('monitors.run-done')}</Pill>
        ) : null}
      </div>

      {steps.length > 0 && (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {steps.map((s) => (
            <li key={s.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 7, fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.4 }}>
              <StepGlyph status={s.status} />
              <span style={{ flex: 1, minWidth: 0 }}>{s.label}</span>
            </li>
          ))}
        </ul>
      )}

      {clean && (
        <div
          ref={proseRef}
          style={{ maxHeight: 160, overflowY: 'auto', fontSize: 11.5, color: 'var(--ink-4)', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
        >
          {clean}
          {running && <span style={{ color: 'var(--ink-5)' }}>▍</span>}
        </div>
      )}

      {running && steps.length === 0 && !clean && (
        <div className="lp-mono" style={{ fontSize: 11, color: 'var(--ink-5)' }}>
          {t('monitors.starting-watcher')}
        </div>
      )}

      {error && <div style={{ fontSize: 11.5, color: 'var(--clay)' }}>{t('monitors.run-failed-label', { error })}</div>}

      {done && !running && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: 'var(--ink-3)' }}>
          <span>
            {done.alerts > 0
              ? done.alerts === 1
                ? t('monitors.found-signals-one', { n: done.alerts })
                : t('monitors.found-signals-other', { n: done.alerts })
              : t('monitors.no-new-signals')}
          </span>
          {done.alerts > 0 && (
            <Link
              href={`/project/${projectId}/actions?lane=signal`}
              onClick={(e) => e.stopPropagation()}
              style={{ color: 'var(--accent)', textDecoration: 'none', fontSize: 11.5 }}
            >
              {t('monitors.view-in-inbox')}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Panel
// =============================================================================

export default function MonitorListPanel({
  projectId,
  compact = false,
  limit,
  title,
  initialExpandedWatcherId,
}: {
  projectId: string;
  compact?: boolean;
  limit?: number;
  title?: string;
  /** Deep-link preselection: the underlying monitor / watch_source id
   *  (?watcher=<id> on /actions). Expanded once the list loads. */
  initialExpandedWatcherId?: string;
}) {
  const t = useT();
  // Default heading is the localized "Watchers"; callers can override (or pass
  // "" to hide it — preserved as a falsy value below).
  const heading = title === undefined ? t('monitors.title') : title;
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery<Watcher[]>({
    queryKey: ['watchers', projectId],
    enabled: !!projectId,
    queryFn: async () => {
      // Iter-3.5: hit the unified /watchers endpoint (returns monitors +
      // watch_sources merged behind the Watcher type). Row expansion fetches
      // the per-monitor detail endpoint lazily (see ExpandableWatcherRow).
      const res = await fetch(`/api/projects/${projectId}/watchers`);
      const body = await res.json();
      if (!body.success || !Array.isArray(body.data)) return [];
      return body.data as Watcher[];
    },
  });

  // Which row is open (keyed by the unified watcher id, e.g. w_m_<monitorId>).
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Deep link is consumed exactly once — after the first list payload that
  // contains the target row.
  const [pendingDeepLink, setPendingDeepLink] = useState<string | null>(initialExpandedWatcherId ?? null);
  useEffect(() => {
    if (initialExpandedWatcherId) setPendingDeepLink(initialExpandedWatcherId);
  }, [initialExpandedWatcherId]);
  useEffect(() => {
    if (!pendingDeepLink || !data) return;
    const match = data.find((w) => w._origin_id === pendingDeepLink || w.id === pendingDeepLink);
    if (match) {
      setExpandedId(match.id);
      // Bring the row into view once it renders expanded.
      setTimeout(() => {
        document.getElementById(`watcher-${match._origin_id}`)?.scrollIntoView({ block: 'center' });
      }, 0);
    }
    setPendingDeepLink(null);
  }, [pendingDeepLink, data]);

  // Iter-3 QA fix: invalidate the watchers query when actions change.
  // When the founder approves a proposed watcher in /actions, the
  // pending_action transitions and a new monitor / watch_source row
  // materializes — but this component cached its list under
  // ['watchers', projectId] and had no listener, leaving the panel stale
  // until a manual refresh. Wired the same way Canvas.tsx listens to facts.
  useEffect(() => {
    if (!projectId) return;
    const handler = () => {
      queryClient.invalidateQueries({ queryKey: ['watchers', projectId] });
    };
    window.addEventListener('lp-actions-changed', handler);
    return () => window.removeEventListener('lp-actions-changed', handler);
  }, [projectId, queryClient]);

  const all = data ?? [];
  const rows = typeof limit === 'number' ? all.slice(0, limit) : all;

  // ---- compact: bare rows, no chrome (parent Panel owns the heading) -------
  if (compact) {
    if (isLoading) return <div style={{ fontSize: 12, color: 'var(--ink-5)', padding: '8px 12px' }}>{t('monitors.loading')}</div>;
    if (rows.length === 0) {
      return <div style={{ fontSize: 12, color: 'var(--ink-5)', padding: '8px 12px' }}>{t('monitors.no-active-watchers')}</div>;
    }
    return <div>{rows.map((w) => <CompactWatcherRow key={w.id} projectId={projectId} w={w} />)}</div>;
  }

  // ---- full: heading + CTA + expandable list --------------------------------
  return (
    <div style={{ padding: '16px 20px', maxWidth: 880 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 14 }}>
        <Icon d={I.signal} size={16} style={{ marginTop: 2 }} />
        {heading && (
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--ink)', flex: 1 }}>
            {heading}
            {all.length > 0 && (
              <span style={{ fontWeight: 400, color: 'var(--ink-5)', marginLeft: 8 }}>{all.length}</span>
            )}
          </h2>
        )}
        {!heading && <div style={{ flex: 1 }} />}
        <NewWatcherForm projectId={projectId} />
      </div>

      {isLoading ? (
        <div style={{ fontSize: 13, color: 'var(--ink-5)', padding: '24px 12px', textAlign: 'center' }}>
          {t('monitors.loading')}
        </div>
      ) : isError ? (
        <div style={{ fontSize: 13, color: 'var(--clay)', padding: '24px 12px', textAlign: 'center' }}>
          {t('monitors.load-error')}
        </div>
      ) : rows.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: '28px 16px', textAlign: 'center', lineHeight: 1.5 }}>
          {t('monitors.empty-state')}
        </div>
      ) : (
        <div>
          {rows.map((w) => (
            <ExpandableWatcherRow
              key={w.id}
              projectId={projectId}
              w={w}
              expanded={expandedId === w.id}
              onToggle={() => setExpandedId((cur) => (cur === w.id ? null : w.id))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
