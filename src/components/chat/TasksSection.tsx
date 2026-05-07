'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Icon, I, Pill } from '@/components/design/primitives';

// =============================================================================
// Types
// =============================================================================

interface TaskListItem {
  id: string;
  title: string;
  description: string | null;
  priority: 'critical' | 'high' | 'medium' | 'low';
  due: string | null;
  client_artifact_id: string | null;
  status: string;
  created_at: string;
  details?: string | null;
  subtasks?: string[] | null;
  references?: Array<{ title?: string; url?: string; quote?: string }> | null;
  estimated_effort?: string | null;
  expanded_at?: string | null;
}

interface TaskExpansion {
  details?: string;
  subtasks?: string[];
  references?: Array<{ title?: string; url?: string; quote?: string; type?: string }>;
  estimated_effort?: string;
  expanded_at?: string;
}

const TASK_PRIORITY_ORDER: TaskListItem['priority'][] = ['critical', 'high', 'medium', 'low'];
const TASK_PRIORITY_STYLES: Record<string, { bg: string; fg: string; label: string }> = {
  critical: { bg: 'var(--clay)',     fg: '#FFF',          label: 'Critical' },
  high:     { bg: 'var(--accent)',   fg: 'var(--ink)',    label: 'High' },
  medium:   { bg: 'var(--sky)',      fg: '#FFF',          label: 'Medium' },
  low:      { bg: 'var(--paper-3)',  fg: 'var(--ink-3)',  label: 'Low' },
};

// =============================================================================
// TasksSection — extracted from chat/page.tsx TasksTab
// =============================================================================

export function TasksSection({
  projectId,
  onAction,
  locale,
}: {
  projectId: string;
  onAction: (action: string, payload: Record<string, unknown>) => Promise<void> | void;
  locale: 'en' | 'it';
}) {
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approvalCount, setApprovalCount] = useState(0);
  const [notificationCount, setNotificationCount] = useState(0);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tasksRes, approvalsRes, notificationsRes] = await Promise.all([
        fetch(`/api/projects/${projectId}/tasks`),
        fetch(`/api/projects/${projectId}/approvals`),
        fetch(`/api/projects/${projectId}/notifications`),
      ]);
      const tasksBody = await tasksRes.json();
      if (!tasksRes.ok || tasksBody?.success === false) {
        throw new Error(tasksBody?.error || `HTTP ${tasksRes.status}`);
      }
      const tasksData = tasksBody?.data ?? tasksBody;
      setTasks(Array.isArray(tasksData?.tasks) ? tasksData.tasks : []);

      try {
        const approvalsBody = await approvalsRes.json();
        const data = approvalsBody?.data ?? approvalsBody;
        setApprovalCount(typeof data?.counts?.total === 'number' ? data.counts.total : 0);
      } catch { setApprovalCount(0); }
      try {
        const notificationsBody = await notificationsRes.json();
        const data = notificationsBody?.data ?? notificationsBody;
        setNotificationCount(typeof data?.counts?.total === 'number' ? data.counts.total : 0);
      } catch { setNotificationCount(0); }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    refetch();
    const handler = () => refetch();
    window.addEventListener('lp-tasks-changed', handler);
    return () => window.removeEventListener('lp-tasks-changed', handler);
  }, [refetch]);

  const grouped = useMemo(() => {
    const map: Record<TaskListItem['priority'], TaskListItem[]> = {
      critical: [], high: [], medium: [], low: [],
    };
    for (const t of tasks) {
      const k = (TASK_PRIORITY_ORDER as string[]).includes(t.priority) ? t.priority : 'medium';
      map[k].push(t);
    }
    return map;
  }, [tasks]);

  const otherLanesTotal = approvalCount + notificationCount;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
      }}
    >
      {otherLanesTotal > 0 && (
        <a
          href={`/project/${projectId}/actions`}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            background: 'var(--paper-2)',
            border: '1px solid var(--line-2)',
            borderRadius: 6,
            fontSize: 11.5,
            color: 'var(--ink-3)',
            textDecoration: 'none',
            fontFamily: 'var(--f-sans)',
          }}
        >
          <span>
            {locale === 'it' ? 'Hai anche ' : 'You also have '}
            {approvalCount > 0 && (
              <strong style={{ color: 'var(--ink-2)' }}>
                {approvalCount} {locale === 'it' ? 'approvazion' + (approvalCount === 1 ? 'e' : 'i') : 'approval' + (approvalCount === 1 ? '' : 's')}
              </strong>
            )}
            {approvalCount > 0 && notificationCount > 0 && ' · '}
            {notificationCount > 0 && (
              <strong style={{ color: 'var(--ink-2)' }}>
                {notificationCount} {locale === 'it' ? 'notific' + (notificationCount === 1 ? 'a' : 'he') : 'notification' + (notificationCount === 1 ? '' : 's')}
              </strong>
            )}
            {locale === 'it' ? ' nell\u2019Inbox.' : ' in the Inbox.'}
          </span>
          <span style={{ color: 'var(--accent)', fontSize: 11 }}>
            {locale === 'it' ? 'Apri Inbox \u2192' : 'Open Inbox \u2192'}
          </span>
        </a>
      )}
      {loading && tasks.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--ink-5)', textAlign: 'center', padding: 40 }}>
          {locale === 'it' ? 'Caricamento task\u2026' : 'Loading tasks\u2026'}
        </div>
      )}
      {error && (
        <div style={{ fontSize: 12, color: 'var(--clay)', textAlign: 'center', padding: 12 }}>
          {error}
        </div>
      )}
      {!loading && !error && tasks.length === 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 60,
            color: 'var(--ink-4)',
            fontSize: 13,
            textAlign: 'center',
          }}
        >
          <h3 className="lp-serif" style={{ fontSize: 18, fontWeight: 400, margin: 0, color: 'var(--ink-3)' }}>
            {locale === 'it' ? 'Nessun task aperto.' : 'No open tasks.'}
          </h3>
          <p style={{ margin: '10px 0 0', maxWidth: 360, lineHeight: 1.5 }}>
            {locale === 'it'
              ? 'Chiedi al co-pilot di aggiungere un task ("aggiungi un task: ...") e apparir\u00e0 qui.'
              : 'Ask the co-pilot to add a task ("add a task: \u2026") and it will appear here.'}
          </p>
        </div>
      )}
      {TASK_PRIORITY_ORDER.map((priority) => {
        const list = grouped[priority];
        if (list.length === 0) return null;
        const style = TASK_PRIORITY_STYLES[priority];
        return (
          <div key={priority}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span
                className="lp-chip"
                style={{ background: style.bg, color: style.fg, border: 'none' }}
              >
                {style.label}
              </span>
              <span style={{ fontSize: 11, color: 'var(--ink-5)', fontFamily: 'var(--f-mono)' }}>
                {list.length}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {list.map((t) => (
                <TaskListRow key={t.id} task={t} onAction={onAction} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// =============================================================================
// TaskListRow
// =============================================================================

function TaskListRow({
  task,
  onAction,
}: {
  task: TaskListItem;
  onAction: (action: string, payload: Record<string, unknown>) => Promise<void> | void;
}) {
  const [busy, setBusy] = useState<false | 'pending' | 'expanding'>(false);
  const [localExpansion, setLocalExpansion] = useState<TaskExpansion>(() => ({
    details: task.details ?? undefined,
    subtasks: task.subtasks ?? undefined,
    references: task.references ?? undefined,
    estimated_effort: task.estimated_effort ?? undefined,
    expanded_at: task.expanded_at ?? undefined,
  }));
  const [checkedSubtasks, setCheckedSubtasks] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!task.client_artifact_id) return;
    const handler = (e: Event) => {
      const evt = e as CustomEvent<{ artifact_id?: string; fields?: TaskExpansion }>;
      if (evt.detail?.artifact_id !== task.client_artifact_id || !evt.detail.fields) return;
      setLocalExpansion((prev) => ({ ...prev, ...evt.detail!.fields }));
      setBusy(false);
    };
    window.addEventListener('lp-task-expanded', handler as EventListener);
    return () => window.removeEventListener('lp-task-expanded', handler as EventListener);
  }, [task.client_artifact_id]);

  async function trigger(verb: 'done' | 'snooze' | 'dismiss' | 'expand') {
    if (busy || !task.client_artifact_id) return;
    setBusy(verb === 'expand' ? 'expanding' : 'pending');
    try {
      await onAction(`task:${verb}`, { artifact_id: task.client_artifact_id });
      if (verb !== 'expand') setBusy(false);
    } catch {
      setBusy(false);
    }
  }

  const hasExpansion =
    !!localExpansion.details ||
    (localExpansion.subtasks && localExpansion.subtasks.length > 0) ||
    !!localExpansion.estimated_effort;
  const canExpand = !hasExpansion && busy !== 'expanding';

  return (
    <div className="lp-card" style={{ padding: 10 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
        <div className="lp-serif" style={{ fontSize: 13, color: 'var(--ink)', flex: 1 }}>
          {task.title}
        </div>
        {localExpansion.estimated_effort && (
          <span
            className="lp-mono"
            style={{
              fontSize: 10,
              color: 'var(--ink-4)',
              border: '1px solid var(--line-2)',
              borderRadius: 'var(--r-s)',
              padding: '1px 6px',
              flexShrink: 0,
              background: 'var(--paper-2)',
            }}
            title="Estimated effort"
          >
            ~ {localExpansion.estimated_effort}
          </span>
        )}
      </div>
      {task.description && (
        <div style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.45, marginBottom: 6 }}>
          {task.description}
        </div>
      )}
      {task.due && (
        <div style={{ fontSize: 10.5, color: 'var(--ink-5)', fontFamily: 'var(--f-mono)', marginBottom: 8 }}>
          due \u00b7 {task.due}
        </div>
      )}
      {busy === 'expanding' && (
        <div style={{ fontSize: 11, color: 'var(--ink-4)', fontStyle: 'italic', marginBottom: 6 }}>
          Expanding plan\u2026
        </div>
      )}

      {hasExpansion && (
        <div
          style={{
            marginTop: 4,
            marginBottom: 8,
            padding: 8,
            background: 'var(--paper-2)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-s)',
          }}
        >
          {localExpansion.details && (
            <div style={{ fontSize: 11.5, color: 'var(--ink-2)', marginBottom: 8, lineHeight: 1.4 }}>
              {localExpansion.details}
            </div>
          )}
          {localExpansion.subtasks && localExpansion.subtasks.length > 0 && (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {localExpansion.subtasks.map((st, i) => {
                const checked = checkedSubtasks.has(i);
                return (
                  <li
                    key={i}
                    onClick={() => {
                      setCheckedSubtasks((prev) => {
                        const next = new Set(prev);
                        if (next.has(i)) next.delete(i); else next.add(i);
                        return next;
                      });
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 6,
                      fontSize: 11.5,
                      color: checked ? 'var(--ink-4)' : 'var(--ink-2)',
                      textDecoration: checked ? 'line-through' : 'none',
                      cursor: 'pointer',
                      lineHeight: 1.4,
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 14,
                        height: 14,
                        flexShrink: 0,
                        marginTop: 2,
                        border: '1px solid var(--line-2)',
                        borderRadius: 3,
                        background: checked ? 'var(--ink)' : 'transparent',
                        color: checked ? 'var(--paper)' : 'transparent',
                        fontSize: 10,
                        lineHeight: 1,
                      }}
                    >
                      {checked ? '\u2713' : ''}
                    </span>
                    <span>{st}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {localExpansion.references && localExpansion.references.length > 0 && (
            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {localExpansion.references.map((r, i) => {
                const label = r?.title ?? r?.url ?? `ref ${i + 1}`;
                const isLink = typeof r?.url === 'string' && r.url.length > 0;
                const chipStyle: React.CSSProperties = {
                  fontSize: 10,
                  color: 'var(--ink-3)',
                  border: '1px solid var(--line-2)',
                  borderRadius: 'var(--r-s)',
                  padding: '1px 6px',
                  background: 'var(--surface)',
                  textDecoration: 'none',
                };
                return isLink ? (
                  <a key={i} href={r.url} target="_blank" rel="noreferrer" style={chipStyle}>
                    {label}
                  </a>
                ) : (
                  <span key={i} style={chipStyle}>{label}</span>
                );
              })}
            </div>
          )}
        </div>
      )}

      {task.client_artifact_id && (
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            disabled={busy !== false}
            onClick={() => trigger('done')}
            style={{
              flex: 1,
              padding: '5px 8px',
              borderRadius: 'var(--r-m)',
              background: 'var(--ink)',
              color: 'var(--paper)',
              border: 'none',
              cursor: busy ? 'wait' : 'pointer',
              fontSize: 11,
              fontFamily: 'inherit',
              opacity: busy ? 0.6 : 1,
            }}
          >
            Mark done
          </button>
          {canExpand && (
            <button
              type="button"
              disabled={busy !== false}
              onClick={() => trigger('expand')}
              title="Ask the agent to break this down into subtasks"
              style={{
                padding: '5px 8px',
                borderRadius: 'var(--r-m)',
                background: 'var(--paper-2)',
                color: 'var(--ink-3)',
                border: '1px solid var(--line-2)',
                cursor: busy ? 'wait' : 'pointer',
                fontSize: 11,
                fontFamily: 'inherit',
              }}
            >
              Expand
            </button>
          )}
          <button
            type="button"
            disabled={busy !== false}
            onClick={() => trigger('snooze')}
            style={{
              padding: '5px 8px',
              borderRadius: 'var(--r-m)',
              background: 'var(--paper-2)',
              color: 'var(--ink-3)',
              border: '1px solid var(--line-2)',
              cursor: busy ? 'wait' : 'pointer',
              fontSize: 11,
              fontFamily: 'inherit',
            }}
          >
            Snooze
          </button>
          <button
            type="button"
            disabled={busy !== false}
            onClick={() => trigger('dismiss')}
            style={{
              padding: '5px 8px',
              borderRadius: 'var(--r-m)',
              background: 'transparent',
              color: 'var(--ink-4)',
              border: '1px solid var(--line-2)',
              cursor: busy ? 'wait' : 'pointer',
              fontSize: 11,
              fontFamily: 'inherit',
            }}
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
