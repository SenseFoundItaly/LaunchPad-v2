/**
 * Launch gate — clone of the Build Hub's assertBuildAllowed posture for the
 * outbound pipeline. Publishing/sending has no LLM cost, but the cap check
 * keeps a runaway proposer bug inert, and LAUNCH_DISABLED is the ops kill
 * switch that stops every publish/send executor in one env flip.
 *
 * Errors are prefixed so API routes can map them: LAUNCH_DISABLED: → 503,
 * LAUNCH_CAPPED: → 402.
 */

import { isProjectCapped } from '@/lib/cost-meter';

export async function assertLaunchAllowed(projectId: string): Promise<void> {
  if (process.env.LAUNCH_DISABLED === '1') {
    throw new Error('LAUNCH_DISABLED: the launch pipeline is switched off (LAUNCH_DISABLED=1).');
  }
  const cap = await isProjectCapped(projectId);
  if (cap.capped) {
    throw new Error(`LAUNCH_CAPPED: project budget is capped for ${cap.periodMonth} — publishing/sending is paused.`);
  }
}
