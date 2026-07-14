'use client';

/**
 * Launch — the growth-lane execution surface (launch pipeline W5): published
 * pages, campaigns (activate → cron proposes each send in the Inbox), and the
 * growth-loop engine's first UI. URL-reachable at /project/{id}/launch; not
 * yet in the NavRail (same posture as PR #218's flag-gated Build nav) — when
 * #218 merges, LaunchPanel mounts inside BuildHub's Growth lane tab instead.
 */

import { use } from 'react';
import { useT } from '@/components/providers/LocaleProvider';
import { PanelBoundary } from '@/components/design/PanelBoundary';
import LaunchPanel from '@/components/launch/LaunchPanel';

export default function LaunchPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const t = useT();
  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '24px 32px', background: 'var(--paper)' }}>
      <header style={{ marginBottom: 20 }}>
        <h1 className="lp-serif" style={{ margin: 0, fontSize: 24, fontWeight: 400, letterSpacing: -0.5 }}>
          {t('launch.page-title')}
        </h1>
      </header>
      <PanelBoundary resetKey={projectId}>
        <LaunchPanel projectId={projectId} />
      </PanelBoundary>
    </div>
  );
}
