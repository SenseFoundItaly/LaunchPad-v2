import type { ActionLane } from '@/lib/action-lanes';

export type InboxSource = 'action' | 'fact' | 'alert';

export type InboxState = 'pending' | 'applied' | 'rejected' | 'busy' | 'error';

export interface InboxAttribution {
  sourceType: string;
  sourceLabel: string;
  seenAt: string;
  upstreamHref?: string;
}

export interface InboxItem {
  id: string;
  source: InboxSource;
  lane: ActionLane;

  title: string;
  detail: string | null;
  kindChip: string | null;

  destination?: string;
  impactHint?: string;
  attribution?: InboxAttribution;

  createdAt: string;
  state: InboxState;

  raw: unknown;
}
