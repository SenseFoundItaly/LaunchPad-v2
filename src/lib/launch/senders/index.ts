/**
 * Sender registry — env-selected (LAUNCH_SENDER) with loud stub fallback,
 * mirror of publishers/index.ts. See types.ts for the single-call-site
 * invariant on send().
 */

import type { SenderAdapter, SenderId } from './types';
import { stubSender } from './stub';
import { resendSender } from './resend';

const REGISTRY: Record<SenderId, SenderAdapter> = {
  stub: stubSender,
  resend: resendSender,
};

export function activeSenderId(): SenderId {
  const id = (process.env.LAUNCH_SENDER || 'stub') as SenderId;
  return id in REGISTRY ? id : 'stub';
}

export function getSender(id: SenderId): SenderAdapter {
  return REGISTRY[id] ?? stubSender;
}

export function getActiveSender(): SenderAdapter {
  const picked = getSender(activeSenderId());
  if (!picked.isConfigured()) {
    console.warn(`[launch] sender "${picked.id}" not configured — falling back to stub`);
    return stubSender;
  }
  return picked;
}

export function listSenders(): SenderAdapter[] {
  return Object.values(REGISTRY);
}
