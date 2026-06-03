'use client';

import Link from 'next/link';
import { Icon, I, Pill } from '@/components/design/primitives';

export interface AssumptionRowLite {
  id: string;
  number: number;
  category: string;
  text: string;
  criticality: 'high' | 'medium' | 'low';
  status: 'open' | 'validated' | 'invalidated' | 'accepted_risk';
  validated_by_skill_completion_id: string | null;
  validation_evidence: string | null;
  invalidated_reason: string | null;
}

interface AssumptionsPanelProps {
  projectId: string;
  assumptions: AssumptionRowLite[];
}

/**
 * Surfaces the unvalidated high-criticality bets the project rests on.
 *
 * Premortem-as-living-registry: an open `high` assumption is the founder's
 * "this could kill me if I'm wrong" list, narrowed to the top few. Items
 * disappear from this surface as skill completions validate them through
 * the linker in src/lib/skill-executor.ts — closing the loop.
 *
 * Hides itself when no high-criticality assumptions are open. A cold-start
 * project (no extractor run yet) sees nothing, not an empty panel — adding
 * noise to Today is the opposite of the panel's job.
 */
export function AssumptionsPanel({ projectId, assumptions }: AssumptionsPanelProps) {
  const open = assumptions
    .filter((a) => a.status === 'open' && a.criticality === 'high')
    .slice(0, 5);

  const totalOpen = assumptions.filter((a) => a.status === 'open').length;
  const totalValidated = assumptions.filter((a) => a.status === 'validated').length;

  // Cold start — render nothing. The card returns when the founder runs
  // the extractor (chat command, onboarding, or POST /assumptions).
  if (assumptions.length === 0) return null;
  if (open.length === 0) {
    // All high-criticality bets validated/closed. Show a thin "all clear" line.
    return (
      <section
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--r-l)',
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          fontSize: 13,
          color: 'var(--ink-3)',
        }}
      >
        <Icon d={I.check} size={14} />
        <span>
          {totalValidated} of {assumptions.length} assumptions validated — no high-criticality bets open.
        </span>
      </section>
    );
  }

  return (
    <section
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-l)',
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 4,
        }}
      >
        <Icon d={I.flag} size={14} />
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', flex: 1 }}>
          Unvalidated bets
        </span>
        <Pill kind="warn" dot>
          {open.length} of {totalOpen} open
        </Pill>
      </header>

      <p
        style={{
          margin: 0,
          fontSize: 11.5,
          color: 'var(--ink-4)',
          marginBottom: 4,
        }}
      >
        High-criticality assumptions still unproven. If any is false, the project breaks.
      </p>

      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {open.map((a) => (
          <li
            key={a.id}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              padding: '8px 10px',
              borderRadius: 6,
              background: 'var(--paper)',
            }}
          >
            <span
              className="lp-mono"
              style={{
                fontSize: 10,
                color: 'var(--ink-5)',
                minWidth: 28,
                paddingTop: 1,
              }}
            >
              #{a.number}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.35 }}>
                {a.text}
              </div>
              <div
                className="lp-mono"
                style={{
                  fontSize: 10,
                  color: 'var(--ink-5)',
                  marginTop: 2,
                  textTransform: 'uppercase',
                  letterSpacing: 0.4,
                }}
              >
                {a.category.replace(/_/g, ' ')}
              </div>
            </div>
          </li>
        ))}
      </ul>

      <Link
        href={`/project/${projectId}/assumptions`}
        style={{
          fontSize: 11,
          color: 'var(--ink-4)',
          textDecoration: 'none',
          marginTop: 4,
          alignSelf: 'flex-start',
        }}
      >
        View all {assumptions.length} →
      </Link>
    </section>
  );
}
