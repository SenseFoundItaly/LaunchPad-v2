/**
 * workflow_step dispatcher (launch pipeline W4) — replaces the "coming soon"
 * placeholder. Maps a founder-approved workflow step to the real machinery:
 *
 *   publish_landing_page → publish the newest html-preview artifact
 *   email_sequence / social_calendar / ad_pack → runSkill (drafts a campaign
 *     deliverable — propose-not-run: activation/sending stays founder-gated)
 *   run_skill → runSkill(payload.skill_id)
 *   anything else → honest manual-tracking narrative (unchanged fallback)
 *
 * Payload: { step_kind, label, skill_id?, params? } (see execute-step route).
 */

import { get } from '@/lib/db';
import { runSkill } from '@/lib/skill-executor';
import { publishLandingPage } from './publish';

const STEP_SKILL: Record<string, string> = {
  email_sequence: 'email-sequence',
  social_calendar: 'social-calendar',
  ad_pack: 'ad-campaign',
};

export interface WorkflowStepOutcome {
  ok: boolean;
  narrative_en: string;
  narrative_it: string;
  url?: string;
  error?: string;
}

export async function executeWorkflowStep(
  projectId: string,
  payload: Record<string, unknown>,
): Promise<WorkflowStepOutcome> {
  const kind = String(payload.step_kind || '');

  if (kind === 'publish_landing_page') {
    const explicit = typeof (payload.params as Record<string, unknown> | undefined)?.artifact_id === 'string'
      ? String((payload.params as Record<string, unknown>).artifact_id)
      : null;
    const artifact = explicit
      ? { id: explicit }
      : await get<{ id: string }>(
          `SELECT id FROM build_artifacts
            WHERE project_id = ? AND artifact_type = 'html-preview'
            ORDER BY created_at DESC LIMIT 1`,
          projectId,
        );
    if (!artifact) {
      return {
        ok: false,
        narrative_en: '', narrative_it: '',
        error: 'No landing page artifact to publish — run the Landing Page skill first.',
      };
    }
    const { url } = await publishLandingPage({ projectId, sourceArtifactId: artifact.id });
    const isStub = url.startsWith('data:');
    return {
      ok: true,
      url: isStub ? undefined : url,
      narrative_en: isStub ? 'Publish recorded (stub driver — no hosting key configured).' : `Landing page published: ${url}`,
      narrative_it: isStub ? 'Pubblicazione registrata (driver stub — nessuna chiave di hosting).' : `Landing page pubblicata: ${url}`,
    };
  }

  const skillId = kind === 'run_skill'
    ? (typeof payload.skill_id === 'string' ? payload.skill_id : '')
    : (STEP_SKILL[kind] ?? '');
  if (skillId) {
    const owner = await get<{ owner_user_id: string | null }>(
      'SELECT owner_user_id FROM projects WHERE id = ?', projectId,
    );
    if (!owner?.owner_user_id) {
      return { ok: false, narrative_en: '', narrative_it: '', error: 'project has no owner to attribute the skill run to' };
    }
    // Founder Apply on the workflow step IS the human initiation — allow any
    // skill (mirrors the run_skill executor posture). The skill only DRAFTS;
    // whatever it produces re-enters the founder gate (campaign activation,
    // publish click, Inbox sends).
    const result = await runSkill(projectId, skillId, { ownerUserId: owner.owner_user_id, allowAnySkill: true });
    return {
      ok: true,
      narrative_en: `Ran ${skillId} — its deliverable is in chat/Data Room (${result.artifacts_persisted} artifact(s) persisted). Anything outbound still needs your approval.`,
      narrative_it: `Eseguita ${skillId} — il deliverable è in chat/Data Room (${result.artifacts_persisted} artifact salvati). Qualsiasi invio richiede ancora la tua approvazione.`,
    };
  }

  return {
    ok: true,
    narrative_en: 'This step has no wired executor — track it manually on the workflow card.',
    narrative_it: 'Questo passo non ha un esecutore collegato — traccialo manualmente sulla card del workflow.',
  };
}
