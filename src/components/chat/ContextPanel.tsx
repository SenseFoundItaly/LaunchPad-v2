'use client';

import { useCallback, useRef, useState } from 'react';
import { Icon, I, Pill } from '@/components/design/primitives';
import { PendingSection } from './PendingSection';
import { TasksSection } from './TasksSection';
import { IntelligenceSection } from './IntelligenceSection';
import { ActivitySection } from './ActivitySection';

// =============================================================================
// ContextPanel — unified "Context" canvas tab with collapsible sections
// =============================================================================

interface ContextPanelProps {
  projectId: string;
  locale: 'en' | 'it';
  onAction: (action: string, payload: Record<string, unknown>) => Promise<void> | void;
}

interface SectionDef {
  id: string;
  label: { en: string; it: string };
  icon: string;
}

const SECTIONS: SectionDef[] = [
  { id: 'pending',      label: { en: 'Pending',      it: 'In attesa' },    icon: I.bell },
  { id: 'tasks',        label: { en: 'Tasks',        it: 'Task' },         icon: I.tickets },
  { id: 'intelligence', label: { en: 'Intelligence', it: 'Intelligence' }, icon: I.graph },
  { id: 'activity',     label: { en: 'Activity',     it: 'Attivit\u00e0' }, icon: I.clock },
];

export function ContextPanel({ projectId, locale, onAction }: ContextPanelProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['pending', 'tasks']));
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingPulse, setPendingPulse] = useState(false);
  const prevPendingCountRef = useRef(0);

  const handlePendingCountChange = useCallback((n: number) => {
    if (n > prevPendingCountRef.current) {
      setExpanded((prev) => new Set([...prev, 'pending']));
      setPendingPulse(true);
      setTimeout(() => setPendingPulse(false), 1500);
    }
    prevPendingCountRef.current = n;
    setPendingCount(n);
  }, []);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div
      className="lp-scroll"
      style={{ flex: 1, overflow: 'auto', padding: 0 }}
    >
      {SECTIONS.map((section) => {
        const isOpen = expanded.has(section.id);
        return (
          <div key={section.id} style={{ borderBottom: '1px solid var(--line)' }}>
            {/* Collapsible header */}
            <button
              type="button"
              onClick={() => toggle(section.id)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 16px',
                background: section.id === 'pending' && pendingPulse
                  ? 'color-mix(in srgb, var(--accent) 8%, var(--surface))'
                  : 'var(--surface)',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--ink)',
                fontSize: 12,
                fontWeight: 600,
                fontFamily: 'var(--f-sans)',
                textAlign: 'left',
                boxShadow: section.id === 'pending' && pendingPulse
                  ? 'inset 0 0 0 1px var(--accent)'
                  : undefined,
                transition: 'background 0.3s, box-shadow 0.3s',
              }}
            >
              <Icon d={section.icon} size={13} style={{ color: 'var(--ink-3)' }} />
              <span style={{ flex: 1 }}>{section.label[locale]}</span>
              {section.id === 'pending' && pendingCount > 0 && (
                <Pill kind="live">{pendingCount}</Pill>
              )}
              <Icon
                d={isOpen ? I.chevd : I.chevr}
                size={11}
                style={{ color: 'var(--ink-4)' }}
              />
            </button>
            {/* Section body */}
            {isOpen && (
              <div style={{ padding: '12px 16px 16px' }}>
                {section.id === 'pending' && (
                  <PendingSection
                    projectId={projectId}
                    onAction={onAction}
                    locale={locale}
                    onCountChange={handlePendingCountChange}
                  />
                )}
                {section.id === 'tasks' && (
                  <TasksSection projectId={projectId} onAction={onAction} locale={locale} />
                )}
                {section.id === 'intelligence' && (
                  <IntelligenceSection projectId={projectId} locale={locale} />
                )}
                {section.id === 'activity' && (
                  <ActivitySection
                    projectId={projectId}
                    locale={locale}
                    onJumpTasks={() => {
                      setExpanded((prev) => new Set([...prev, 'tasks']));
                      const el = document.querySelector('.lp-scroll');
                      if (el) el.scrollTop = 0;
                    }}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
