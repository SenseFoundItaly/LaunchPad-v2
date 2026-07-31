/**
 * Validation-Gate sub-tracks (walkthrough §2) — the ONE definition of the 1A /
 * 1B / 1C labels, their hover explainers, and their render order.
 *
 * Only the validation stage tags its checks with a track; everywhere else
 * `track` is undefined and the checks render flat.
 *
 * This lives in lib (not in either component) because BOTH the Home StageCard
 * and the Canvas SpineSection render these tracks. They previously kept private
 * copies of the label map, which is exactly how two surfaces drift apart — and
 * pointing one component at the other's export would drag a whole client
 * component into the other's bundle.
 */

import type { MessageKey } from '@/lib/i18n/messages';

export type TrackId = '1A' | '1B' | '1C';

/** Header shown above the track's check rows. */
export const TRACK_LABEL: Record<TrackId, MessageKey> = {
  '1A': 'canvas.track-1a',
  '1B': 'canvas.track-1b',
  '1C': 'canvas.track-1c',
};

/** Hover explainer: what this track proves (and, for 1C, why it starts locked). */
export const TRACK_TIP: Record<TrackId, MessageKey> = {
  '1A': 'canvas.tip-track-1a',
  '1B': 'canvas.tip-track-1b',
  '1C': 'canvas.tip-track-1c',
};

export const TRACK_ORDER: readonly TrackId[] = ['1A', '1B', '1C'];
