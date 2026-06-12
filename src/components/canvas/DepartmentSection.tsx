'use client';

/**
 * DepartmentSection — collapsible group of artifacts that share a department.
 *
 * Renders each artifact using ArtifactRenderer (so we get the same card
 * components as the chat bubbles for monitor/budget proposals, plus
 * dedicated cards for charts, tables, personas, etc.). The lp-card chrome
 * around each artifact carries the back-link to the source message and the
 * focused / dimmed turn-linking state.
 *
 * `count` includes only artifacts in this department's list (caller filters).
 */

import { useState } from 'react';
import type { Artifact, Department } from '@/types/artifacts';
import ArtifactRenderer from '@/components/chat/artifacts/ArtifactRenderer';
import { spanForArtifact } from '@/lib/artifact-layout';
import { Icon, I } from '@/components/design/primitives';

interface DepartmentEntry {
  artifact: Artifact;
  sourceMessageId: string;
  turnIndex: number;
}

interface DepartmentSectionProps {
  department: Department;
  locale: 'en' | 'it';
  entries: DepartmentEntry[];
  handleArtifactAction: (action: string, payload: Record<string, unknown>) => Promise<void> | void;
  focusedMessageId: string | null;
  /** Default-collapsed? Defaults to false. Empty departments are hidden by the parent. */
  defaultCollapsed?: boolean;
  /** Skim-first collapse: artifacts whose turnIndex is older than this render
   *  with defaultCollapsed on their card shell; latest-turn artifacts open. */
  latestTurnIndex: number;
}

const DEPT_LABELS: Record<Department, { en: string; it: string }> = {
  market: { en: 'Market', it: 'Mercato' },
  product: { en: 'Product', it: 'Prodotto' },
  pricing: { en: 'Pricing', it: 'Pricing' },
  finance: { en: 'Finance', it: 'Finanze' },
  growth: { en: 'Growth', it: 'Crescita' },
  memory: { en: 'Memory', it: 'Memoria' },
};

export function DepartmentSection({
  department,
  locale,
  entries,
  handleArtifactAction,
  focusedMessageId,
  defaultCollapsed = false,
  latestTurnIndex,
}: DepartmentSectionProps) {
  const [open, setOpen] = useState(!defaultCollapsed);
  const label = DEPT_LABELS[department][locale];

  return (
    <section style={{ marginBottom: 18 }}>
      {/* Slim plain-text header: `Market · 3` — no icon chip, no card chrome.
          Still a button: clicking toggles the section open/collapsed. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 0',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          color: 'inherit',
          marginBottom: open ? 8 : 2,
        }}
      >
        <span
          className="lp-serif"
          style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}
        >
          {label}
        </span>
        <span
          className="lp-mono"
          style={{ fontSize: 11, color: 'var(--ink-5)' }}
        >
          · {entries.length}
        </span>
        <span style={{ flex: 1 }} />
        <Icon d={open ? I.chevd : I.chevr} size={11} style={{ color: 'var(--ink-5)' }} />
      </button>
      {open && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(6, 1fr)',
            gap: 10,
          }}
        >
          {entries.map((entry) => (
            <ArtifactSlot
              key={entry.artifact.id}
              entry={entry}
              focusedMessageId={focusedMessageId}
              handleArtifactAction={handleArtifactAction}
              latestTurnIndex={latestTurnIndex}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ArtifactSlot({
  entry,
  focusedMessageId,
  handleArtifactAction,
  latestTurnIndex,
}: {
  entry: DepartmentEntry;
  focusedMessageId: string | null;
  handleArtifactAction: (action: string, payload: Record<string, unknown>) => Promise<void> | void;
  latestTurnIndex: number;
}) {
  const isFocused = focusedMessageId !== null && entry.sourceMessageId === focusedMessageId;
  const isDimmed = focusedMessageId !== null && !isFocused;
  const span = spanForArtifact(entry.artifact);
  // Skim-first: only the latest turn's artifacts open by default.
  const collapsed = entry.turnIndex < latestTurnIndex;

  const handleBackLink = () => {
    const el = document.querySelector(`[data-message-id="${entry.sourceMessageId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('lp-flash');
      setTimeout(() => el.classList.remove('lp-flash'), 1200);
    }
  };

  // monitor-proposal / budget-proposal: render bare (their own card chrome).
  if (entry.artifact.type === 'monitor-proposal' || entry.artifact.type === 'budget-proposal') {
    return (
      <div
        data-artifact-id={entry.artifact.id}
        style={{
          gridColumn: 'span 6',
          opacity: isDimmed ? 0.35 : 1,
          transition: 'opacity 150ms ease',
        }}
        className={isFocused ? 'ring-2 ring-accent rounded-lg' : ''}
      >
        <ArtifactRenderer
          artifact={entry.artifact}
          onAction={(a, p) => handleArtifactAction(a, p)}
          onEntityDiscovered={() => {}}
          onWorkflowDiscovered={() => {}}
          defaultCollapsed={collapsed}
        />
      </div>
    );
  }

  return (
    <div
      data-artifact-id={entry.artifact.id}
      className={`lp-card ${isFocused ? 'ring-2 ring-accent' : ''}`}
      style={{
        gridColumn: `span ${span}`,
        opacity: isDimmed ? 0.35 : 1,
        transition: 'opacity 150ms ease',
        cursor: 'default',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          padding: '4px 6px 0',
        }}
      >
        <button
          type="button"
          onClick={handleBackLink}
          title="Scroll to source message"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 18,
            height: 18,
            border: 'none',
            borderRadius: 4,
            background: 'transparent',
            color: 'var(--ink-5)',
            cursor: 'pointer',
          }}
        >
          <Icon d={I.link} size={11} />
        </button>
      </div>
      <div style={{ padding: '0 10px 10px' }}>
        <ArtifactRenderer
          artifact={entry.artifact}
          onAction={(a, p) => handleArtifactAction(a, p)}
          onEntityDiscovered={() => {}}
          onWorkflowDiscovered={() => {}}
          defaultCollapsed={collapsed}
        />
      </div>
    </div>
  );
}
