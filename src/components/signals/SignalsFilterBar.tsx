'use client';

import { Icon, I } from '@/components/design/primitives';
import type { CompetitorProfile } from '@/types';

interface SignalsFilterBarProps {
  searchQuery: string;
  onSearchChange: (v: string) => void;
  competitorFilter: string;
  onCompetitorFilter: (v: string) => void;
  competitors: CompetitorProfile[];
  platformFilter: string;
  onPlatformFilter: (v: string) => void;
  impactFilter: string;
  onImpactFilter: (v: string) => void;
  daysFilter: number;
  onDaysFilter: (v: number) => void;
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: '7px 10px 7px 30px',
  border: '1px solid var(--line-2)',
  borderRadius: 6,
  background: 'var(--paper)',
  color: 'var(--ink)',
  fontSize: 12,
  fontFamily: 'var(--f-sans)',
  outline: 'none',
  minWidth: 0,
};

const selectStyle: React.CSSProperties = {
  padding: '7px 8px',
  border: '1px solid var(--line-2)',
  borderRadius: 6,
  background: 'var(--paper)',
  color: 'var(--ink)',
  fontSize: 11,
  fontFamily: 'var(--f-sans)',
  outline: 'none',
  cursor: 'pointer',
};

export function SignalsFilterBar({
  searchQuery,
  onSearchChange,
  competitorFilter,
  onCompetitorFilter,
  competitors,
  platformFilter,
  onPlatformFilter,
  impactFilter,
  onImpactFilter,
  daysFilter,
  onDaysFilter,
}: SignalsFilterBarProps) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        padding: '10px 20px',
        borderBottom: '1px solid var(--line)',
        background: 'var(--surface)',
        alignItems: 'center',
      }}
    >
      {/* Search */}
      <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
        <Icon
          d={I.search}
          size={13}
          style={{
            position: 'absolute',
            left: 10,
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--ink-5)',
            pointerEvents: 'none',
          }}
        />
        <input
          type="text"
          placeholder="Search signals..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          style={inputStyle}
        />
      </div>

      {/* Competitor */}
      <select
        value={competitorFilter}
        onChange={(e) => onCompetitorFilter(e.target.value)}
        style={selectStyle}
      >
        <option value="all">All competitors</option>
        {competitors.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>

      {/* Platform */}
      <select
        value={platformFilter}
        onChange={(e) => onPlatformFilter(e.target.value)}
        style={selectStyle}
      >
        <option value="all">All platforms</option>
        <option value="monitor">Monitors</option>
        <option value="watch_source">Watch sources</option>
      </select>

      {/* Impact */}
      <select
        value={impactFilter}
        onChange={(e) => onImpactFilter(e.target.value)}
        style={selectStyle}
      >
        <option value="all">All impact</option>
        <option value="critical">Critical</option>
        <option value="notable">Notable</option>
        <option value="normal">Normal</option>
        <option value="informational">Informational</option>
      </select>

      {/* Date */}
      <select
        value={String(daysFilter)}
        onChange={(e) => onDaysFilter(Number(e.target.value))}
        style={selectStyle}
      >
        <option value="7">7 days</option>
        <option value="30">30 days</option>
        <option value="90">90 days</option>
      </select>
    </div>
  );
}
