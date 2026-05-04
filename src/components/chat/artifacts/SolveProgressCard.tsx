'use client';

import type { SolveProgressArtifact, SolveStageStatus } from '@/types/artifacts';

const STATUS_COLORS: Record<SolveStageStatus, { circle: string; line: string; text: string }> = {
  completed: { circle: 'var(--moss)', line: 'var(--moss)', text: 'var(--ink-2)' },
  active: { circle: 'var(--accent)', line: 'var(--line-2)', text: 'var(--ink-1)' },
  pending: { circle: 'var(--ink-5)', line: 'var(--line-2)', text: 'var(--ink-4)' },
  skipped: { circle: 'var(--line-2)', line: 'var(--line-2)', text: 'var(--ink-5)' },
};

export default function SolveProgressCard({ artifact }: { artifact: SolveProgressArtifact }) {
  const { stages } = artifact;

  return (
    <div
      style={{
        gridColumn: 'span 6',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-m)',
        padding: '20px 24px',
        background: 'var(--surface)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>
          Solve Flow
        </span>
        <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>
          {stages.filter(s => s.status === 'completed').length}/{stages.length} complete
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {stages.map((stage, i) => {
          const colors = STATUS_COLORS[stage.status];
          const isLast = i === stages.length - 1;

          return (
            <div key={stage.id} style={{ display: 'flex', gap: 14 }}>
              {/* Circle + connecting line */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  width: 20,
                }}
              >
                <div
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: '50%',
                    background: stage.status === 'active' ? 'transparent' : colors.circle,
                    border: stage.status === 'active'
                      ? `2px solid ${colors.circle}`
                      : 'none',
                    boxShadow: stage.status === 'active'
                      ? `0 0 0 3px ${colors.circle}33`
                      : 'none',
                    flexShrink: 0,
                    // Pulse animation for active stage
                    animation: stage.status === 'active' ? 'solve-pulse 2s ease-in-out infinite' : 'none',
                  }}
                />
                {!isLast && (
                  <div
                    style={{
                      width: 2,
                      flex: 1,
                      minHeight: 24,
                      background: colors.line,
                    }}
                  />
                )}
              </div>

              {/* Stage content */}
              <div style={{ paddingBottom: isLast ? 0 : 16, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: stage.status === 'active' ? 600 : 400,
                      color: colors.text,
                      textDecoration: stage.status === 'skipped' ? 'line-through' : 'none',
                    }}
                  >
                    {stage.label}
                  </span>
                  {stage.status === 'completed' && (
                    <span className="lp-mono" style={{ fontSize: 10, color: 'var(--moss)' }}>
                      done
                    </span>
                  )}
                  {stage.status === 'active' && (
                    <span className="lp-mono" style={{ fontSize: 10, color: 'var(--accent)' }}>
                      in progress
                    </span>
                  )}
                  {stage.status === 'skipped' && (
                    <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>
                      skipped
                    </span>
                  )}
                </div>
                {stage.summary && (
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--ink-4)', lineHeight: 1.5 }}>
                    {stage.summary}
                  </p>
                )}
                {stage.skill_id && stage.status === 'completed' && (
                  <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)', marginTop: 2, display: 'block' }}>
                    via {stage.skill_id}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* CSS animation for the active pulse */}
      <style>{`
        @keyframes solve-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}
