'use client';

/**
 * InboxGroup — a collapsible group of triage rows for the Knowledge Inbox.
 * Each row: select checkbox + title + source/age + optional confidence bar +
 * apply / edit / reject actions. Grouped by finding type.
 */

import * as React from 'react';
import { Icon, I } from '@/components/design/icons';

export interface TriageRow {
  id: string;
  title: string;
  source?: string;
  age?: string;
  /** 0..1 — omitted hides the confidence bar for that row. */
  confidence?: number | null;
}

export interface InboxGroupProps {
  label: string;
  rows: TriageRow[];
  collapsed?: boolean;
  onToggle?: () => void;
  selected: Set<string>;
  onSelect: (id: string) => void;
  onApply: (id: string) => void;
  onEdit?: (id: string) => void;
  onReject: (id: string) => void;
}

function confColor(c: number): string {
  return c > 0.8 ? 'var(--moss)' : c > 0.6 ? 'var(--cat-gold)' : 'var(--clay)';
}

function RowBtn({ d, tone, title, onClick }: { d: string; tone: string; title: string; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{ height: 24, width: 26, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: '1px solid transparent', borderRadius: 'var(--r-s)', color: tone, cursor: 'pointer' }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'var(--paper-2)')}
      onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'transparent')}
    >
      <Icon d={d} size={11} />
    </button>
  );
}

export function InboxGroup({ label, rows, collapsed, onToggle, selected, onSelect, onApply, onEdit, onReject }: InboxGroupProps) {
  return (
    <div style={{ padding: '14px 24px', borderBottom: '1px solid var(--line)' }}>
      <button
        onClick={onToggle}
        className="lp-row"
        style={{ marginBottom: 8, gap: 6, background: 'transparent', border: 'none', padding: 0, cursor: onToggle ? 'pointer' : 'default', color: 'inherit' }}
      >
        <Icon d={collapsed ? I.chevr : I.chevd} size={11} style={{ color: 'var(--ink-4)' }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>{label}</span>
        <span className="lp-mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>{rows.length}</span>
      </button>
      {!collapsed && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-m)', overflow: 'hidden' }}>
          {rows.map((r, i) => {
            const sel = selected.has(r.id);
            const hasConf = typeof r.confidence === 'number' && !Number.isNaN(r.confidence);
            return (
              <div key={r.id} className="lp-row" style={{ padding: '10px 12px', borderTop: i > 0 ? '1px solid var(--line)' : 'none', gap: 12 }}>
                <button
                  onClick={() => onSelect(r.id)}
                  aria-label={sel ? 'Deselect' : 'Select'}
                  style={{ width: 15, height: 15, borderRadius: 3, border: '1.5px solid var(--line-2)', background: sel ? 'var(--ink)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer', padding: 0 }}
                >
                  {sel && <Icon d={I.check} size={10} style={{ color: 'var(--paper)' }} />}
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: 'var(--ink)' }}>{r.title}</div>
                  {(r.source || r.age) && (
                    <div className="lp-row" style={{ marginTop: 3, gap: 8 }}>
                      {r.source && <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-4)' }}>{r.source}</span>}
                      {r.source && r.age && <span style={{ color: 'var(--ink-5)' }}>·</span>}
                      {r.age && <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-4)' }}>{r.age}</span>}
                    </div>
                  )}
                </div>
                {hasConf && (
                  <div className="lp-row" style={{ gap: 4, flexShrink: 0 }}>
                    <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-4)' }}>{Math.round(r.confidence! * 100)}%</span>
                    <div style={{ width: 36, height: 3, background: 'var(--line-2)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.round(r.confidence! * 100)}%`, height: '100%', background: confColor(r.confidence!) }} />
                    </div>
                  </div>
                )}
                <div className="lp-row" style={{ gap: 2, flexShrink: 0 }}>
                  <RowBtn d={I.check} tone="var(--moss)" title="Apply" onClick={() => onApply(r.id)} />
                  {onEdit && <RowBtn d={I.edit} tone="var(--ink-4)" title="Edit" onClick={() => onEdit(r.id)} />}
                  <RowBtn d={I.x} tone="var(--clay)" title="Reject" onClick={() => onReject(r.id)} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
