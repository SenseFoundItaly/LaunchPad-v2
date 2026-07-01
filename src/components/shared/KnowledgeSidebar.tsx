'use client';

/**
 * KnowledgeSidebar — the left nav for the Knowledge surface: views
 * (All / Inbox / Pinned / Archive / Graph) + an optional tag list. Tag/Pinned/
 * Archive have no backing columns yet, so callers pass what's real and the
 * empty tag block is simply hidden rather than faked.
 */

import * as React from 'react';
import { Icon, I, type IconKey } from '@/components/design/icons';
import type { KnowledgeTone } from './KnowledgeRow';

export interface KnowledgeView {
  id: string;
  label: string;
  iconKey: IconKey;
  count?: number;
  /** Highlight the count (e.g. Inbox with pending items). */
  hi?: boolean;
}

const TONE_VAR: Record<KnowledgeTone, string> = {
  ok: 'var(--moss)', warn: 'var(--clay)', info: 'var(--sky)', plum: 'var(--plum)', accent: 'var(--accent)', n: 'var(--ink-5)',
};

export interface KnowledgeSidebarProps {
  views: KnowledgeView[];
  active: string;
  onSelect: (id: string) => void;
  tags?: { tag: string; count: number; tone?: KnowledgeTone }[];
  onSelectTag?: (tag: string) => void;
}

export function KnowledgeSidebar({ views, active, onSelect, tags = [], onSelectTag }: KnowledgeSidebarProps) {
  return (
    <div style={{ width: 200, flexShrink: 0, borderRight: '1px solid var(--line)', background: 'var(--paper)', padding: '14px 8px', overflow: 'auto' }}>
      <div className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: 0.5, padding: '0 8px 8px' }}>Knowledge</div>
      {views.map((v) => {
        const on = v.id === active;
        return (
          <button
            key={v.id}
            onClick={() => onSelect(v.id)}
            className="lp-row"
            style={{ width: '100%', padding: '7px 8px', borderRadius: 'var(--r-s)', background: on ? 'var(--surface)' : 'transparent', color: on ? 'var(--ink)' : 'var(--ink-2)', fontSize: 12, cursor: 'pointer', gap: 8, marginBottom: 1, border: 'none', textAlign: 'left' }}
          >
            <Icon d={I[v.iconKey]} size={12} style={{ color: on ? 'var(--ink)' : 'var(--ink-4)' }} />
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.label}</span>
            {typeof v.count === 'number' && (
              <span className="lp-mono" style={{ fontSize: 10, color: v.hi ? 'var(--accent)' : 'var(--ink-4)' }}>{v.count}</span>
            )}
          </button>
        );
      })}
      {tags.length > 0 && (
        <>
          <div className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: 0.5, padding: '14px 8px 6px' }}>Tags</div>
          {tags.map((t) => (
            <button
              key={t.tag}
              onClick={() => onSelectTag?.(t.tag)}
              className="lp-row"
              style={{ width: '100%', padding: '5px 8px', fontSize: 11.5, color: 'var(--ink-2)', cursor: onSelectTag ? 'pointer' : 'default', gap: 7, background: 'transparent', border: 'none', textAlign: 'left' }}
            >
              <span className="lp-dot" style={{ background: TONE_VAR[t.tone ?? 'n'] }} />
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.tag}</span>
              <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-4)' }}>{t.count}</span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}
