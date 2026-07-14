/**
 * Publisher registry — env-selected driver with stub fallback, cloned from the
 * Build Hub's builder registry (src/lib/builders/index.ts). LAUNCH_PUBLISHER
 * picks the driver; an unconfigured pick falls back to stub LOUDLY (log) so a
 * missing key downgrades gracefully instead of failing every publish.
 *
 * Reserved next drivers (do not build yet): 'vercel' (parity), plus the ad
 * platforms live in their own future ChannelAdapter — see plan PR-C notes.
 */

import type { PublisherAdapter, PublisherId } from './types';
import { stubPublisher } from './stub';
import { netlifyPublisher } from './netlify';

const REGISTRY: Record<PublisherId, PublisherAdapter> = {
  stub: stubPublisher,
  netlify: netlifyPublisher,
};

export function activePublisherId(): PublisherId {
  const id = (process.env.LAUNCH_PUBLISHER || 'stub') as PublisherId;
  return id in REGISTRY ? id : 'stub';
}

export function getPublisher(id: PublisherId): PublisherAdapter {
  return REGISTRY[id] ?? stubPublisher;
}

export function getActivePublisher(): PublisherAdapter {
  const picked = getPublisher(activePublisherId());
  if (!picked.isConfigured()) {
    console.warn(`[launch] publisher "${picked.id}" not configured — falling back to stub`);
    return stubPublisher;
  }
  return picked;
}

export function listPublishers(): PublisherAdapter[] {
  return Object.values(REGISTRY);
}
