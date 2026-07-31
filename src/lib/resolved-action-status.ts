/**
 * Pure helpers for the reload-guard on inline proposal cards
 * (useResolvedActionStatus). Kept in lib/ (not the hook file) so the parsing —
 * which bit us once — is unit-tested; src/hooks is excluded from vitest.
 */

import type { PendingActionStatus } from '@/types';

export type ResolvedStatus = Extract<PendingActionStatus, 'applied' | 'sent' | 'rejected' | 'failed'>;

/**
 * id→status map from the /actions response. The route nests the array under
 * `data.actions`; reading `data` as the array silently yielded {} (no seed →
 * card stayed clickable after refresh). Legacy flat shapes accepted defensively.
 */
export function extractResolvedMap(body: unknown): Record<string, ResolvedStatus> {
  const b = body as { data?: { actions?: unknown }; actions?: unknown } | null;
  const rows: unknown = Array.isArray(b?.data?.actions)
    ? b!.data!.actions
    : Array.isArray(b?.actions)
      ? b!.actions
      : Array.isArray((b as { data?: unknown })?.data)
        ? (b as { data: unknown[] }).data
        : Array.isArray(b)
          ? b
          : [];
  const map: Record<string, ResolvedStatus> = {};
  for (const r of rows as Array<{ id?: string; status?: string }>) {
    if (r?.id && r?.status) map[r.id] = r.status as ResolvedStatus;
  }
  return map;
}
