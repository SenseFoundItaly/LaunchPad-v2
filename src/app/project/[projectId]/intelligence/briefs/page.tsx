'use client';

/**
 * Intelligence · Daily briefs — a feed of synthesized intelligence briefs.
 * REAL: /intelligence-briefs (reuses the existing BriefCard).
 */

import { use } from 'react';
import { useSetChrome } from '@/components/design/chrome-context';
import { IntelFrame } from '@/components/intelligence/IntelFrame';
import { useIntelligenceBriefs } from '@/hooks/useIntelligenceBriefs';
import { BriefCard } from '@/components/signals/BriefCard';

export default function IntelBriefsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const { briefs, loading } = useIntelligenceBriefs(projectId);

  useSetChrome({ breadcrumb: ['Intelligence', 'Daily briefs'] }, []);

  return (
    <IntelFrame projectId={projectId} activeView="briefs">
      <h1 className="lp-h3" style={{ margin: 0 }}>Daily briefs</h1>
      <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 2 }}>{briefs.length} active {briefs.length === 1 ? 'brief' : 'briefs'}</div>
      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {loading ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--ink-4)', fontSize: 12.5 }}>Loading briefs…</div>
        ) : briefs.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--ink-4)', fontSize: 12.5 }}>No briefs yet. Briefs are synthesized as watchers accumulate signals.</div>
        ) : (
          briefs.map((b) => <BriefCard key={b.id} brief={b} />)
        )}
      </div>
    </IntelFrame>
  );
}
