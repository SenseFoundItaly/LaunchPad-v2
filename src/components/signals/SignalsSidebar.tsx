'use client';

import { Icon, I } from '@/components/design/primitives';
import type { CompetitorProfile } from '@/types';

// Category groupings from alert types
export interface CategoryDef {
  label: string;
  icon: string;
  types: string[];
}

export const CATEGORY_GROUPS: CategoryDef[] = [
  { label: 'Patents & IP',        icon: I.shield,   types: ['ip_filing'] },
  { label: 'Hiring',              icon: I.users,    types: ['hiring_signal'] },
  { label: 'Funding',             icon: I.dollar,   types: ['funding_event'] },
  { label: 'Products',            icon: I.bolt,     types: ['product_launch', 'competitor_activity'] },
  { label: 'Pricing',             icon: I.fund,     types: ['pricing_change'] },
  { label: 'Social & Sentiment',  icon: I.heart,    types: ['social_signal', 'customer_sentiment'] },
  { label: 'Partnerships',        icon: I.link,     types: ['partnership_opportunity'] },
  { label: 'Regulatory',          icon: I.flag,     types: ['regulatory_change'] },
  { label: 'Trends',              icon: I.sparkles, types: ['trend_signal'] },
  { label: 'Advertising',         icon: I.eye,      types: ['ad_activity'] },
];

export type ViewMode = 'feed' | 'sources' | 'log';

interface SignalsSidebarProps {
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  competitors: CompetitorProfile[];
  competitorFilter: string;
  onCompetitorFilter: (id: string) => void;
  competitorCounts: Record<string, number>;
  categoryFilter: string;
  onCategoryFilter: (label: string) => void;
  categoryCounts: Record<string, number>;
  collapsed: boolean;
}

export function SignalsSidebar({
  view,
  onViewChange,
  competitors,
  competitorFilter,
  onCompetitorFilter,
  competitorCounts,
  categoryFilter,
  onCategoryFilter,
  categoryCounts,
  collapsed,
}: SignalsSidebarProps) {
  if (collapsed) return null;

  return (
    <div
      style={{
        width: 240,
        flexShrink: 0,
        borderRight: '1px solid var(--line)',
        background: 'var(--surface)',
        overflow: 'auto',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* View toggle */}
      <div style={{ padding: '12px 14px 8px', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', borderRadius: 6, border: '1px solid var(--line-2)', overflow: 'hidden' }}>
          {([
            { key: 'feed' as const, label: 'Feed', icon: I.bell },
            { key: 'sources' as const, label: 'Sources', icon: I.globe },
            { key: 'log' as const, label: 'Log', icon: I.clock },
          ]).map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => onViewChange(key)}
              style={{
                flex: 1,
                padding: '6px 0',
                border: 'none',
                background: view === key ? 'var(--ink)' : 'var(--paper)',
                color: view === key ? 'var(--paper)' : 'var(--ink-4)',
                fontSize: 11,
                fontWeight: 600,
                fontFamily: 'var(--f-sans)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
              }}
            >
              <Icon d={icon} size={11} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Competitors */}
      <div style={{ padding: '12px 14px 4px' }}>
        <SectionHeader>Competitors</SectionHeader>
        <SidebarRow
          label="All competitors"
          count={Object.values(competitorCounts).reduce((a, b) => a + b, 0)}
          active={competitorFilter === 'all'}
          onClick={() => onCompetitorFilter('all')}
        />
        {competitors.map((c) => (
          <SidebarRow
            key={c.id}
            label={c.name}
            count={competitorCounts[c.name] || 0}
            active={competitorFilter === c.id}
            onClick={() => onCompetitorFilter(c.id)}
            initials={c.name.slice(0, 2).toUpperCase()}
          />
        ))}
        {competitors.length === 0 && (
          <div style={{ fontSize: 11, color: 'var(--ink-5)', padding: '4px 0' }}>No competitors tracked.</div>
        )}
      </div>

      {/* Categories */}
      <div style={{ padding: '8px 14px 14px' }}>
        <SectionHeader>Categories</SectionHeader>
        <SidebarRow
          label="All categories"
          count={Object.values(categoryCounts).reduce((a, b) => a + b, 0)}
          active={categoryFilter === 'all'}
          onClick={() => onCategoryFilter('all')}
        />
        {CATEGORY_GROUPS.map((g) => (
          <SidebarRow
            key={g.label}
            label={g.label}
            icon={g.icon}
            count={categoryCounts[g.label] || 0}
            active={categoryFilter === g.label}
            onClick={() => onCategoryFilter(g.label)}
          />
        ))}
      </div>
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 600,
        color: 'var(--ink-3)',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  );
}

function SidebarRow({
  label,
  count,
  active,
  onClick,
  icon,
  initials,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  icon?: string;
  initials?: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        padding: '6px 8px',
        border: 'none',
        borderRadius: 6,
        background: active ? 'var(--accent-wash)' : 'transparent',
        cursor: 'pointer',
        fontSize: 12,
        fontFamily: 'var(--f-sans)',
        color: active ? 'var(--accent-ink)' : 'var(--ink-2)',
        fontWeight: active ? 600 : 400,
        textAlign: 'left',
      }}
    >
      {initials && (
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            background: 'var(--paper-2)',
            border: '1px solid var(--line-2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 9,
            fontWeight: 700,
            color: 'var(--ink-4)',
            flexShrink: 0,
          }}
        >
          {initials}
        </span>
      )}
      {icon && <Icon d={icon} size={13} style={{ flexShrink: 0, color: active ? 'var(--accent-ink)' : 'var(--ink-4)' }} />}
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <span
        className="lp-mono"
        style={{ fontSize: 10, color: active ? 'var(--accent-ink)' : 'var(--ink-5)', flexShrink: 0 }}
      >
        {count}
      </span>
    </button>
  );
}
