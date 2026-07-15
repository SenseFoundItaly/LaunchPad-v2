/**
 * Agent registry (nanocorp P1) — the three named agents that personify
 * LaunchPad's EXISTING background machinery. This is identity, not runtime:
 * no new loops or workers — the cron proposers, executors, and sweeps that
 * already run gain a name, a chat voice (narrate.ts), and (P2) a mandate
 * check. `producerFromType` (Inbox subsystem badge) stays truthful underneath;
 * this layers the founder-facing persona on top.
 *
 *   Builder  — MVP builds: iteration proposer/executor, build sweeps,
 *              start_mvp_build / iterate_mvp_build chat tools.
 *   Marketer — outbound: campaign send proposer/executor, page publishing,
 *              social queue, workflow-step dispatch.
 *   Analyst  — measurement & intel: signups measure sweep, watchers/signals,
 *              correlator briefs, skill refreshes, weekly heartbeat.
 */

import type { PendingActionType } from '@/types';
import type { MessageKey } from '@/lib/i18n/messages';

export type AgentId = 'builder' | 'marketer' | 'analyst';

export interface AgentDef {
  id: AgentId;
  nameKey: MessageKey;
  descKey: MessageKey;
  /** Design-token color for the chat chip / presence dot. */
  color: string;
  /** Which existing pending_action types this agent speaks for. */
  actionTypes: readonly PendingActionType[];
  /** Cron phases it personifies — documentation-grade attribution. */
  cronPhases: readonly string[];
}

export const AGENTS: Record<AgentId, AgentDef> = {
  builder: {
    id: 'builder',
    nameKey: 'agents.builder.name' as MessageKey,
    descKey: 'agents.builder.desc' as MessageKey,
    color: 'var(--accent)',
    actionTypes: ['mvp_build_iteration'],
    cronPhases: ['B1 sweepBuildingBuilds', 'B2 proposeMvpIterationsCron'],
  },
  marketer: {
    id: 'marketer',
    nameKey: 'agents.marketer.name' as MessageKey,
    descKey: 'agents.marketer.desc' as MessageKey,
    color: 'var(--moss)',
    actionTypes: ['send_campaign_message', 'publish_landing_page', 'workflow_step', 'draft_email', 'draft_linkedin_post', 'draft_linkedin_dm'],
    cronPhases: ['B3 proposeDueCampaignSends'],
  },
  analyst: {
    id: 'analyst',
    nameKey: 'agents.analyst.name' as MessageKey,
    descKey: 'agents.analyst.desc' as MessageKey,
    color: 'var(--clay)',
    actionTypes: ['signal_alert', 'intelligence_brief', 'skill_rerun_result', 'propose_assumption_revision'],
    cronPhases: ['B4 collectAssetMetrics', 'monitors', 'watch sources', 'weekly pulse (correlations + heartbeats)'],
  },
};

export function isAgentId(v: unknown): v is AgentId {
  return v === 'builder' || v === 'marketer' || v === 'analyst';
}

export function agentForActionType(t: PendingActionType): AgentId | null {
  for (const def of Object.values(AGENTS)) {
    if ((def.actionTypes as readonly string[]).includes(t)) return def.id;
  }
  return null;
}
