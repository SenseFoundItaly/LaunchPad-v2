'use client';

/**
 * IntelSidebar — the Intelligence-track left nav: the "Watching" competitor
 * list (real, from /competitors) + view switch (Competitor / Daily briefs /
 * All signals feed). `myBusiness` marks the founder's own tracked entity.
 */

import * as React from 'react';

export interface WatchedEntity {
  slug: string;
  name: string;
  /** New-signals count (optional). */
  count?: number;
  trend?: 'up' | 'down' | 'flat';
  myBusiness?: boolean;
}

export interface IntelView {
  id: string;
  label: string;
}

export interface IntelSidebarProps {
  watching: WatchedEntity[];
  selectedSlug?: string;
  onSelectEntity?: (slug: string) => void;
  views: IntelView[];
  activeView: string;
  onSelectView: (id: string) => void;
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14, border: '1px solid var(--line)', borderRadius: 'var(--r-m)', padding: 8 }}>
      <div className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: 0.5, padding: '2px 4px 8px' }}>{label}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>{children}</div>
    </div>
  );
}

export function IntelSidebar({ watching, selectedSlug, onSelectEntity, views, activeView, onSelectView }: IntelSidebarProps) {
  return (
    <div style={{ width: 220, flexShrink: 0, borderRight: '1px solid var(--line)', background: 'var(--paper)', padding: 14, overflow: 'auto' }}>
      <Group label="Watching">
        {watching.length === 0 && <div style={{ fontSize: 11.5, color: 'var(--ink-4)', padding: '4px 6px' }}>No watchers yet.</div>}
        {watching.map((w) => {
          const on = w.slug === selectedSlug;
          return (
            <button
              key={w.slug}
              onClick={() => onSelectEntity?.(w.slug)}
              className="lp-row"
              style={{ width: '100%', padding: '6px 8px', borderRadius: 'var(--r-s)', background: on ? 'var(--surface)' : 'transparent', cursor: 'pointer', fontSize: 12, gap: 8, border: 'none', textAlign: 'left' }}
            >
              <span style={{ width: 18, height: 18, borderRadius: 4, background: 'var(--paper-2)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: 'var(--ink-4)', flexShrink: 0 }}>
                {w.name.charAt(0).toUpperCase()}
              </span>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: on ? 'var(--ink)' : 'var(--ink-2)' }}>{w.name}</span>
              {w.myBusiness && <span className="lp-mono" style={{ fontSize: 9, color: 'var(--ink-4)' }}>you</span>}
              {typeof w.count === 'number' && w.count > 0 && <span className="lp-mono" style={{ fontSize: 10, color: 'var(--accent)' }}>{w.count}</span>}
            </button>
          );
        })}
      </Group>
      <Group label="Views">
        {views.map((v) => (
          <button
            key={v.id}
            onClick={() => onSelectView(v.id)}
            className="lp-row"
            style={{ width: '100%', padding: '6px 8px', borderRadius: 'var(--r-s)', background: activeView === v.id ? 'var(--surface)' : 'transparent', cursor: 'pointer', fontSize: 12, color: activeView === v.id ? 'var(--ink)' : 'var(--ink-2)', border: 'none', textAlign: 'left' }}
          >
            {v.label}
          </button>
        ))}
      </Group>
    </div>
  );
}
