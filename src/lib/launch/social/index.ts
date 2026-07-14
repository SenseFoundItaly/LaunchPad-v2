/**
 * Social registry — env-selected (LAUNCH_SOCIAL) like publishers/senders.
 * 'clicktosend' is the identity driver: it is never post()ed through — the
 * send-proposer routes those messages to the existing draft executors
 * instead, so the founder's own click publishes. It exists in the registry
 * so `getActiveSocial().id` is the single switch the proposer keys on.
 */

import type { SocialAdapter, SocialId } from './types';
import { ayrshareSocial } from './ayrshare';

const clickToSend: SocialAdapter = {
  id: 'clicktosend',
  label: 'Click-to-send (your own accounts)',
  isConfigured: () => true,
  async post() {
    // Structurally unreachable: the proposer never routes to the executor for
    // this driver. Refuse loudly rather than pretend.
    return { ok: false, stubbed: true, error: 'clicktosend driver does not post programmatically' };
  },
};

const REGISTRY: Record<SocialId, SocialAdapter> = {
  clicktosend: clickToSend,
  ayrshare: ayrshareSocial,
};

export function activeSocialId(): SocialId {
  const id = (process.env.LAUNCH_SOCIAL || 'clicktosend') as SocialId;
  return id in REGISTRY ? id : 'clicktosend';
}

export function getActiveSocial(): SocialAdapter {
  const picked = REGISTRY[activeSocialId()];
  if (!picked.isConfigured()) {
    console.warn(`[launch] social "${picked.id}" not configured — falling back to click-to-send`);
    return clickToSend;
  }
  return picked;
}
