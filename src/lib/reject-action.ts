/**
 * Shared rejection side-effects — the ONE implementation behind every
 * "founder said no" entry point: the Inbox route transition
 * (actions/[actionId]/route.ts) AND the chat agent's dismiss_pending_actions
 * tool (project-tools.ts).
 *
 * The reject transition itself is a pure state-machine call; everything a
 * dismissal must ALSO do lives here — source-row propagation, the Loop-1
 * founder-first release, preference learning. This used to be inlined in the
 * route only, so the chat tool silently skipped the Loop-1 release: a founder
 * who cleared the PSF-review card via chat left the loop open and Phase 2
 * gated with nothing left to act on — the §4 dead-end, re-opened through a
 * second door (2026-07-10 gap audit H1). One helper, zero drift.
 */

import { query } from '@/lib/db';
import { rejectPendingAction } from '@/lib/pending-actions';
import { dismissAlertSource } from '@/lib/action-executors';
import { overrideLoop1 } from '@/lib/loops/loop1-psf';
import { overrideLoop } from '@/lib/loops/loop-core';
import { recordFact } from '@/lib/memory/facts';
import { recordEvent } from '@/lib/memory/events';
import type { PendingAction } from '@/types';

export async function rejectActionWithSideEffects(
  existing: PendingAction,
  reason?: string,
): Promise<PendingAction> {
  const projectId = existing.project_id;
  const trimmedReason =
    typeof reason === 'string' && reason.trim() ? reason.slice(0, 500) : undefined;

  const updated = await rejectPendingAction(existing.id, trimmedReason);

  // Propagate the dismissal to the source row (ecosystem_alert / brief /
  // assumption) — the mirror of accept's knowledge write. Without it a
  // dismissed signal/brief/assumption stays 'pending'/'active'/'open' and
  // keeps surfacing on every NON-inbox reader (Intelligence panel, Today,
  // /assumptions). Non-fatal; the reject already succeeded.
  await dismissAlertSource(existing);

  // Loop 1 Founder-first escape (linee guida §4: "il sistema non può
  // bloccare il founder"). The PSF-review proposal is founder-gated;
  // dismissing it IS the founder choosing to ignore the loop. Release it
  // (ignore-with-motivation) so an open Loop 1 doesn't gate Phase 2
  // (business-model / financial-model) indefinitely. Mirrors the
  // approve→'active' branch in executeAppliedAction. The reject `reason`
  // becomes the motivation (§4/§8 "con motivazione registrata"); non-fatal.
  if (existing.action_type === 'run_skill') {
    const p = (existing.payload && typeof existing.payload === 'object'
      ? existing.payload
      : (() => { try { return JSON.parse(String(existing.payload ?? '{}')); } catch { return {}; } })()) as Record<string, unknown>;
    // Any run_skill card carrying a loop_id is a validation-loop review. The
    // review skill IS the loop discriminator (no extra query): Loop 1 is the
    // only loop that proposes psf-review; Loop 2 proposes business-model. n=1
    // keeps Loop 1's original override path byte-for-byte; the rest use the
    // generic loop-core override (which reads loop_number off the row and emits
    // the right loop{N}_override event).
    if (typeof p.loop_id === 'string') {
      const isLoop1 = p.skill_id === 'psf-review';
      const ownerRow = (await query<{ owner_user_id: string | null }>(
        'SELECT owner_user_id FROM projects WHERE id = ?', projectId,
      ))[0];
      const ownerUserId = ownerRow?.owner_user_id || '';
      const motivation = trimmedReason ?? (isLoop1
        ? 'Founder dismissed the PSF review and chose to proceed.'
        : 'Founder dismissed the loop review and chose to proceed.');
      const release = isLoop1 ? overrideLoop1 : overrideLoop;
      await release(projectId, p.loop_id, ownerUserId, motivation)
        .catch((err) => console.warn('[reject] loop override failed (non-fatal):', (err as Error).message));
    }
  }

  // Preference learning: the agent proposed something the founder didn't
  // want. Record a low-confidence 'preference' fact so future
  // buildMemoryContext calls include "user rejected X" in the prompt,
  // steering the agent away from similar proposals. source_type
  // 'approval_inbox' is EXCLUDED from the journey keyword counter
  // (countMemoryFactsMatching) — this fact quotes the rejected proposal's
  // title and the founder's reason, i.e. a NO; it must never green a gated
  // spine check. Non-fatal.
  try {
    const owner = (await query<{ owner_user_id: string | null }>(
      'SELECT owner_user_id FROM projects WHERE id = ?', projectId,
    ))[0];
    if (owner?.owner_user_id) {
      const reasonSuffix = trimmedReason ? `. Reason: ${trimmedReason.slice(0, 200)}` : '';
      const factText = `User rejected agent-proposed action "${existing.title}" (type: ${existing.action_type})${reasonSuffix}`;
      await recordFact({
        userId: owner.owner_user_id,
        projectId,
        fact: factText,
        kind: 'preference',
        sourceType: 'approval_inbox',
        sourceId: existing.id,
        confidence: 0.6,
      });
      await recordEvent({
        userId: owner.owner_user_id,
        projectId,
        eventType: 'action_rejected',
        payload: {
          action_id: existing.id,
          title: existing.title,
          action_type: existing.action_type,
          reason: trimmedReason ?? null,
        },
      });
    }
  } catch (err) {
    console.warn('[reject] preference-learning hook failed (non-fatal):', err);
  }

  return updated;
}
