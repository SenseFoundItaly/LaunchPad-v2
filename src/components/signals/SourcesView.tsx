'use client';

import { Panel, Pill, Icon, I } from '@/components/design/primitives';
import { WatchSourceCard } from '@/components/signals/WatchSourceCard';
import { AddSourceForm } from '@/components/signals/AddSourceForm';
import type { WatchSource } from '@/types';

interface SourcesViewProps {
  sources: (WatchSource & { last_change_at?: string | null; total_changes?: number })[];
  projectId: string;
  onRefresh: () => void;
  loading: boolean;
}

export function SourcesView({ sources, projectId, onRefresh, loading }: SourcesViewProps) {
  const activeSources = sources.filter((s) => s.status === 'active').length;

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16, overflow: 'auto', flex: 1 }}>
      <Panel
        title="Watch sources"
        subtitle={`${sources.length} tracked`}
        right={
          <Pill kind={activeSources > 0 ? 'ok' : 'n'}>
            {activeSources} active
          </Pill>
        }
      >
        {sources.length === 0 && !loading ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink-5)', fontSize: 12 }}>
            No watch sources yet. Add a URL below to start tracking changes.
          </div>
        ) : (
          <div>
            {sources.map((s) => (
              <WatchSourceCard
                key={s.id}
                source={s}
                projectId={projectId}
                onRefresh={onRefresh}
              />
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Add source" right={<Icon d={I.plus} size={12} style={{ color: 'var(--ink-4)' }} />}>
        <AddSourceForm projectId={projectId} onAdded={onRefresh} />
      </Panel>
    </div>
  );
}
