'use client';

/**
 * IntelFrame — shared Intelligence-track shell: the "Watching" competitor
 * sidebar (real, /competitors) + view switch (Competitor / Daily briefs /
 * All signals), with the active view's content in the main pane.
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { IntelSidebar, type WatchedEntity } from '@/components/shared/IntelSidebar';

export interface CompetitorProfile {
  id: string;
  name: string;
  slug: string;
  total_signals?: number;
  trend_direction?: 'up' | 'down' | 'flat' | null;
  signal_counts?: Record<string, number>;
  metadata?: Record<string, unknown> | null;
}

export function useCompetitors(projectId: string) {
  return useQuery<CompetitorProfile[]>({
    queryKey: ['competitors', projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/competitors`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      const list = body?.data ?? body;
      return Array.isArray(list) ? list : [];
    },
  });
}

const VIEWS = [
  { id: 'competitor', label: 'Competitor', route: 'intelligence' },
  { id: 'briefs', label: 'Daily briefs', route: 'intelligence/briefs' },
  { id: 'signals', label: 'All signals feed', route: 'intelligence/signals' },
];

export function IntelFrame({
  projectId,
  activeView,
  selectedSlug,
  onSelectEntity,
  children,
}: {
  projectId: string;
  activeView: 'competitor' | 'briefs' | 'signals';
  selectedSlug?: string;
  onSelectEntity?: (slug: string) => void;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { data: competitors = [] } = useCompetitors(projectId);

  const watching: WatchedEntity[] = competitors.map((c) => ({
    slug: c.slug,
    name: c.name,
    count: c.total_signals,
    trend: c.trend_direction ?? undefined,
    myBusiness: (c.metadata?.is_self as boolean | undefined) || false,
  }));

  return (
    <div className="lp-rise" style={{ flex: 1, minWidth: 0, display: 'flex', minHeight: 0 }}>
      <IntelSidebar
        watching={watching}
        selectedSlug={selectedSlug}
        onSelectEntity={onSelectEntity}
        views={VIEWS.map((v) => ({ id: v.id, label: v.label }))}
        activeView={activeView}
        onSelectView={(id) => {
          const v = VIEWS.find((x) => x.id === id);
          if (v) router.push(`/project/${projectId}/${v.route}`);
        }}
      />
      <div className="lp-scroll" style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: '20px 28px' }}>
        {children}
      </div>
    </div>
  );
}
