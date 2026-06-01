import { laneFor, type ActionLane } from '@/lib/action-lanes';
import type { PendingAction, PendingActionType } from '@/types';
import type { InboxAttribution, InboxItem } from './types';

const ACTION_DESTINATION: Record<string, { destination: string; impact: string }> = {
  task:                         { destination: 'Tasks',           impact: 'Added to your task list' },
  configure_monitor:            { destination: 'Monitors',        impact: 'Monitor will activate' },
  configure_budget:             { destination: 'Budget',          impact: 'Cap updated immediately' },
  configure_watch_source:       { destination: 'Watch Sources',   impact: 'Source tracking begins' },
  draft_email:                  { destination: 'Drafts',          impact: 'Ready to send' },
  draft_linkedin_post:          { destination: 'Drafts',          impact: 'Ready to publish' },
  draft_linkedin_dm:            { destination: 'Drafts',          impact: 'Ready to send' },
  proposed_hypothesis:          { destination: 'Knowledge',       impact: 'Informs future AI responses' },
  proposed_interview_question:  { destination: 'Knowledge',       impact: 'Informs future AI responses' },
  proposed_landing_copy:        { destination: 'Knowledge',       impact: 'Informs future AI responses' },
  proposed_investor_followup:   { destination: 'Knowledge',       impact: 'Informs future AI responses' },
  proposed_graph_update:        { destination: 'Knowledge Graph', impact: 'Updates entity connections' },
  workflow_step:                { destination: 'Workflow',        impact: 'Step marked complete' },
  skill_rerun_result:           { destination: 'Results',         impact: 'Acknowledged' },
};

const FACT_TYPE_DESTINATION: Record<string, { destination: string; impact: string }> = {
  fact:           { destination: 'Knowledge',       impact: 'Informs future AI responses' },
  graph_node:     { destination: 'Knowledge Graph', impact: 'Updates entity connections' },
  tabular_review: { destination: 'Reviews',         impact: 'Saved to project context' },
};

const FACT_TYPE_LABEL: Record<string, string> = {
  fact: 'Fact',
  graph_node: 'Entity',
  tabular_review: 'Review',
};

export interface KnowledgeRow {
  id: string;
  type: 'fact' | 'graph_node' | 'tabular_review';
  title: string;
  detail: string | null;
  kind: string | null;
  reviewed_state: 'pending' | 'applied' | 'rejected';
  created_at: string;
}

export function actionToInbox(action: PendingAction): InboxItem {
  const lane = laneFor(action.action_type as PendingActionType);
  const dest = ACTION_DESTINATION[action.action_type];
  const attribution = actionAttribution(action);
  return {
    id: action.id,
    source: 'action',
    lane,
    title: action.title,
    detail: action.rationale ?? null,
    kindChip: action.action_type.replace(/_/g, ' '),
    destination: dest?.destination,
    impactHint: dest?.impact,
    attribution,
    createdAt: action.created_at,
    state: action.status === 'edited' ? 'pending' : 'pending',
    raw: action,
  };
}

export function factToInbox(row: KnowledgeRow): InboxItem {
  const dest = FACT_TYPE_DESTINATION[row.type];
  return {
    id: row.id,
    source: 'fact',
    lane: 'approval',
    title: row.title,
    detail: row.detail,
    kindChip: FACT_TYPE_LABEL[row.type] ?? row.type,
    destination: dest?.destination,
    impactHint: dest?.impact,
    attribution: factAttribution(row),
    createdAt: row.created_at,
    state: 'pending',
    raw: row,
  };
}

function actionAttribution(action: PendingAction): InboxAttribution | undefined {
  if (action.monitor_run_id) {
    return {
      sourceType: 'monitor',
      sourceLabel: 'ecosystem monitor',
      seenAt: action.created_at,
    };
  }
  if (action.ecosystem_alert_id) {
    return {
      sourceType: 'alert',
      sourceLabel: 'ecosystem alert',
      seenAt: action.created_at,
    };
  }
  return undefined;
}

function factAttribution(row: KnowledgeRow): InboxAttribution | undefined {
  if (row.kind && row.kind !== 'review') {
    return {
      sourceType: row.type,
      sourceLabel: row.kind,
      seenAt: row.created_at,
    };
  }
  return undefined;
}

export async function applyInboxItem(
  item: InboxItem,
  projectId: string,
  edits?: Record<string, unknown>,
): Promise<void> {
  if (item.source === 'action') {
    const body: Record<string, unknown> = { transition: 'apply' };
    if (edits) body.edited_payload = edits;
    const res = await fetch(`/api/projects/${projectId}/actions/${item.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await readError(res, 'apply action'));
    notifyInboxChanged(projectId);
    return;
  }

  if (item.source === 'fact') {
    const res = await fetch(`/api/projects/${projectId}/knowledge/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: 'applied' }),
    });
    if (!res.ok) throw new Error(await readError(res, 'apply knowledge'));
    notifyInboxChanged(projectId);
    return;
  }

  throw new Error(`applyInboxItem: source "${item.source}" not yet implemented`);
}

export async function rejectInboxItem(
  item: InboxItem,
  projectId: string,
  reason?: string,
): Promise<void> {
  if (item.source === 'action') {
    const body: Record<string, unknown> = { transition: 'reject' };
    if (reason) body.reason = reason;
    const res = await fetch(`/api/projects/${projectId}/actions/${item.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await readError(res, 'reject action'));
    notifyInboxChanged(projectId);
    return;
  }

  if (item.source === 'fact') {
    const res = await fetch(`/api/projects/${projectId}/knowledge/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: 'rejected' }),
    });
    if (!res.ok) throw new Error(await readError(res, 'reject knowledge'));
    notifyInboxChanged(projectId);
    return;
  }

  throw new Error(`rejectInboxItem: source "${item.source}" not yet implemented`);
}

export async function restoreInboxItem(item: InboxItem, projectId: string): Promise<void> {
  if (item.source === 'fact') {
    const res = await fetch(`/api/projects/${projectId}/knowledge/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: 'pending' }),
    });
    if (!res.ok) throw new Error(await readError(res, 'undo knowledge'));
    notifyInboxChanged(projectId);
    return;
  }
  throw new Error(`restoreInboxItem: source "${item.source}" not supported (actions are not reversible)`);
}

async function readError(res: Response, label: string): Promise<string> {
  try {
    const body = await res.json();
    return body?.error || `${label} failed: HTTP ${res.status}`;
  } catch {
    return `${label} failed: HTTP ${res.status}`;
  }
}

function notifyInboxChanged(projectId: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('lp-actions-changed', { detail: { projectId } }));
}

export const ACTION_LANE_BUTTONS: Record<ActionLane, { hasReject: boolean }> = {
  approval:     { hasReject: true },
  todo:         { hasReject: true },
  notification: { hasReject: false },
};
