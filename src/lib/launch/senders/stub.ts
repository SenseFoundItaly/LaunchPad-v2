/**
 * Stub sender — logs instead of sending (mirrors src/lib/email.ts's keyless
 * behavior). Keeps the whole campaign pipeline testable without a key and
 * without a single real email leaving the system.
 */

import type { SenderAdapter, SendInput, SendOutcome } from './types';

export const stubSender: SenderAdapter = {
  id: 'stub',
  label: 'Stub (no sending)',
  isConfigured: () => true,
  async send(input: SendInput): Promise<SendOutcome> {
    console.log(`[launch:stub] would send "${input.subject}" to ${input.to.length} recipient(s) for project ${input.projectId}`);
    return { ok: true, stubbed: true, providerRef: 'stub' };
  },
};
