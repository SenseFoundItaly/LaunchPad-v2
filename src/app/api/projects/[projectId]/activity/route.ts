import { NextRequest } from 'next/server';
import { json, error } from '@/lib/api-helpers';
import { get, query } from '@/lib/db';

/**
 * GET /api/projects/{projectId}/activity
 *
 * Read-only chronological feed for the Canvas → Activity tab. UNION over the
 * write-paths that already exist (chat_messages, pending_actions,
 * ecosystem_alerts, memory_events, monitor_runs) — no new schema, no new
 * write path. The synthetic id is `${source}:${row_id}` so React keys are
 * stable across refetches.
 */

type ActivityTag = 'TASK' | 'ALERT' | 'SCAN' | 'CEO' | 'CHIEF' | 'YOU' | 'DRAFT' | 'AGENT';

interface ActivityEvent {
  id: string;
  at: string;
  tag: ActivityTag;
  label: string;
  body?: string;
  href?: string;
}

interface ChatRow {
  id: string;
  role: string;
  content: string | null;
  timestamp: string;
}
interface PendingRow {
  id: string;
  action_type: string;
  title: string;
  priority: string | null;
  payload: string | null;
  created_at: string;
}
interface AlertRow {
  id: string;
  headline: string;
  body: string | null;
  source_url: string | null;
  relevance_score: number;
  created_at: string;
}
interface MemEventRow {
  id: string;
  event_type: string;
  payload: string | null;
  created_at: string;
}
interface MonitorRunRow {
  id: string;
  status: string;
  summary: string | null;
  alerts_generated: number;
  monitor_name: string | null;
  monitor_type: string | null;
  run_at: string;
}

function chatLabel(role: string, content: string): { tag: ActivityTag; label: string } {
  const trimmed = content.replace(/:::artifact[\s\S]*?:::/g, '').trim();
  const head = trimmed.slice(0, 100);
  if (role === 'user') return { tag: 'YOU', label: head || '(empty)' };
  return { tag: 'CHIEF', label: head || '(reply)' };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
  const { projectId } = await params;
  const url = new URL(request.url);
  const since = url.searchParams.get('since');

  const project = await get<{ id: string }>('SELECT id FROM projects WHERE id = ?', projectId);
  if (!project) return error('Project not found', 404);

  const sinceClause = since ? 'AND created_at > ?' : '';
  const sinceTsClause = since ? 'AND timestamp > ?' : '';
  const sinceRunClause = since ? 'AND run_at > ?' : '';

  // chat_messages
  const chatParams: unknown[] = [projectId];
  if (since) chatParams.push(since);
  const chats = await query<ChatRow>(
    `SELECT id, role, content, timestamp
     FROM chat_messages
     WHERE project_id = ? ${sinceTsClause}
     ORDER BY timestamp DESC LIMIT 100`,
    ...chatParams,
  );

  // pending_actions (split into TASK / DRAFT by action_type)
  const paParams: unknown[] = [projectId];
  if (since) paParams.push(since);
  const actions = await query<PendingRow>(
    `SELECT id, action_type, title, priority, payload, created_at
     FROM pending_actions
     WHERE project_id = ? ${sinceClause}
     ORDER BY created_at DESC LIMIT 100`,
    ...paParams,
  );

  // ecosystem_alerts
  const alertParams: unknown[] = [projectId];
  if (since) alertParams.push(since);
  const alerts = await query<AlertRow>(
    `SELECT id, headline, body, source_url, relevance_score, created_at
     FROM ecosystem_alerts
     WHERE project_id = ? ${sinceClause}
     ORDER BY created_at DESC LIMIT 100`,
    ...alertParams,
  );

  // memory_events (CEO heartbeat reflection + task proposals)
  const memParams: unknown[] = [projectId];
  if (since) memParams.push(since);
  const memEvents = await query<MemEventRow>(
    `SELECT id, event_type, payload, created_at
     FROM memory_events
     WHERE project_id = ?
       AND event_type IN ('heartbeat_reflection', 'task_proposed')
       ${sinceClause}
     ORDER BY created_at DESC LIMIT 100`,
    ...memParams,
  );

  // monitor_runs — join to monitors for name/type
  const runParams: unknown[] = [projectId];
  if (since) runParams.push(since);
  const runs = await query<MonitorRunRow>(
    `SELECT mr.id, mr.status, mr.summary, mr.alerts_generated,
            m.name as monitor_name, m.type as monitor_type, mr.run_at
     FROM monitor_runs mr
     LEFT JOIN monitors m ON m.id = mr.monitor_id
     WHERE mr.project_id = ? ${sinceRunClause}
     ORDER BY mr.run_at DESC LIMIT 50`,
    ...runParams,
  );

  const events: ActivityEvent[] = [];

  for (const c of chats) {
    const { tag, label } = chatLabel(c.role, c.content || '');
    events.push({
      id: `chat:${c.id}`,
      at: c.timestamp,
      tag,
      label,
    });
  }

  for (const a of actions) {
    const isTask = a.action_type === 'task';
    const isSkillRerun = a.action_type === 'skill_rerun_result';
    let tag: ActivityTag;
    if (isTask) tag = 'TASK';
    else if (isSkillRerun) tag = 'AGENT';
    else tag = 'DRAFT';
    const pri = a.priority ? ` (${a.priority})` : '';
    const payload = a.payload as unknown as { source?: string; summary_preview?: string } | null;
    let label: string;
    if (isTask) {
      label = `Created task: ${a.title}${pri}`;
    } else if (isSkillRerun) {
      label = a.title;
    } else {
      label = `Draft proposed: ${a.title}`;
    }
    let body: string | undefined;
    if (isSkillRerun) {
      body = payload?.summary_preview?.slice(0, 220);
    } else if (payload?.source === 'heartbeat') {
      body = 'proposed by daily heartbeat';
    }
    events.push({
      id: `action:${a.id}`,
      at: a.created_at,
      tag,
      label,
      body,
    });
  }

  for (const al of alerts) {
    events.push({
      id: `alert:${al.id}`,
      at: al.created_at,
      tag: 'ALERT',
      label: `${al.headline} (relevance ${al.relevance_score.toFixed(2)})`,
      body: al.body ? al.body.slice(0, 220) : undefined,
      href: al.source_url || undefined,
    });
  }

  for (const m of memEvents) {
    if (m.event_type === 'heartbeat_reflection') {
      const payload = m.payload as unknown as { summary?: string; pending_count?: number; alerts_count?: number } | null;
      const counts = payload
        ? `${payload.pending_count ?? 0} pending · ${payload.alerts_count ?? 0} alerts`
        : '';
      events.push({
        id: `mem:${m.id}`,
        at: m.created_at,
        tag: 'CEO',
        label: counts ? `Heartbeat reflection (${counts})` : 'Heartbeat reflection',
        body: payload?.summary?.slice(0, 220),
      });
    } else {
      const payload = m.payload as unknown as { title?: string; priority?: string } | null;
      const pri = payload?.priority ? ` (${payload.priority})` : '';
      events.push({
        id: `mem:${m.id}`,
        at: m.created_at,
        tag: 'CEO',
        label: `Proposed task: ${payload?.title ?? 'untitled'}${pri}`,
      });
    }
  }

  for (const r of runs) {
    const name = r.monitor_name || r.monitor_type || 'monitor';
    events.push({
      id: `run:${r.id}`,
      at: r.run_at,
      tag: 'SCAN',
      label: `Monitor ${name} ${r.status === 'completed' ? 'ran' : r.status} — ${r.alerts_generated} signals`,
      body: r.summary ? r.summary.slice(0, 220) : undefined,
    });
  }

  events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const capped = events.slice(0, 100);

  return json({ events: capped });
  } catch (e) {
    console.error('[activity] unhandled error:', e);
    return error((e as Error).message || 'Internal error', 500);
  }
}
