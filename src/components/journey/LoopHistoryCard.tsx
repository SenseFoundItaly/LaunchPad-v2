'use client';

/**
 * LoopHistoryCard — the durable read surface for validation-loop verdicts
 * (plan happy-beacon B4 / walkthrough §8: the Evidence Matrix is "un documento
 * strutturato", not a one-time chat card).
 *
 * The GO/PIVOT/STOP verdict card is a chat option-set — NON_RETRIEVABLE by
 * design (it's an actionable control; resurrecting it re-invites the guarded
 * double-click problem). The durable truth is the validation_loops row, which
 * GET /loops already returns (verdict, verdict_evidence, override_motivation).
 * This card renders that record: one row per resolved/in-review loop with its
 * verdict badge and the deterministic Evidence Matrix (wtp/pain/urgency
 * signals vs thresholds). Self-hides while the project has no loop history —
 * most founders never trip Loop 1.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Icon, I } from '@/components/design/primitives';
import { useT } from '@/components/providers/LocaleProvider';
import type { MessageKey } from '@/lib/i18n/messages';

interface LoopSignal { signal: string; value: number; threshold: number; passed: boolean }
interface EvidenceMatrix {
  wtp_rate?: number; pain_rate?: number; interviews?: number; iterations?: number;
  signals?: LoopSignal[]; summary?: string;
}
interface LoopRow {
  id: string;
  loop_number: number;
  iteration: number;
  status: 'proposed' | 'active' | 'in_review' | 'closed';
  verdict: 'GO' | 'PIVOT' | 'STOP' | null;
  verdict_evidence: EvidenceMatrix | string | null;
  override_motivation: string | null;
  created_at: string;
  closed_at: string | null;
}

const LOOP_LABEL_KEY: Record<number, MessageKey> = {
  1: 'loops.loop1-label' as MessageKey,
};

const SIGNAL_LABEL_KEY: Record<string, MessageKey> = {
  wtp_rate: 'loops.signal-wtp' as MessageKey,
  pain_confirmed_rate: 'loops.signal-pain' as MessageKey,
  urgency_rate: 'loops.signal-urgency' as MessageKey,
};

const VERDICT_COLOR: Record<string, string> = {
  GO: 'var(--moss)',
  PIVOT: 'var(--accent)',
  STOP: 'var(--clay)',
};

function parseEvidence(raw: EvidenceMatrix | string | null): EvidenceMatrix | null {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw) as EvidenceMatrix; } catch { return null; }
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function LoopHistoryCard({ projectId }: { projectId: string }) {
  const t = useT();
  const [openId, setOpenId] = useState<string | null>(null);

  const { data: loops } = useQuery<LoopRow[]>({
    queryKey: ['loops', projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/loops`);
      const body = await res.json();
      const rows = (body?.data ?? body) as LoopRow[];
      return Array.isArray(rows) ? rows : [];
    },
  });

  // Only resolved (or verdict-pending) loops carry a story worth re-reading;
  // 'proposed'/'active' loops already have a live card in chat/Inbox.
  const resolved = (loops ?? []).filter((l) => l.status === 'closed' || l.status === 'in_review');
  if (resolved.length === 0) return null;

  return (
    <section style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-l)', overflow: 'hidden' }}>
      <header style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon d={I.signal} size={13} stroke={1.4} style={{ color: 'var(--ink-3)' }} />
        <h2 style={{ margin: 0, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--ink-3)' }}>
          {t('loops.title')}
        </h2>
      </header>

      <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {resolved.map((loop) => {
          const evidence = parseEvidence(loop.verdict_evidence);
          const expanded = openId === loop.id;
          const overridden = loop.status === 'closed' && !loop.verdict && !!loop.override_motivation;
          const badgeText = loop.verdict
            ?? (overridden ? t('loops.overridden') : loop.status === 'in_review' ? t('loops.in-review') : t('loops.closed'));
          const badgeColor = loop.verdict ? VERDICT_COLOR[loop.verdict] : 'var(--ink-4)';
          const date = loop.closed_at ?? loop.created_at;
          const hasDetail = !!evidence || overridden;
          return (
            <li key={loop.id} style={{ borderBottom: '1px solid var(--line)' }}>
              <button
                onClick={() => hasDetail && setOpenId(expanded ? null : loop.id)}
                style={{
                  width: '100%', textAlign: 'left', border: 'none', background: 'transparent',
                  padding: '10px 16px', cursor: hasDetail ? 'pointer' : 'default',
                  display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'inherit',
                }}
              >
                <span style={{ fontSize: 12.5, color: 'var(--ink-1)', flex: 1, minWidth: 0 }}>
                  {t(LOOP_LABEL_KEY[loop.loop_number] ?? ('loops.loop1-label' as MessageKey))}
                </span>
                <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>
                  {t('loops.iterations', { count: loop.iteration })}
                </span>
                <span
                  className="lp-mono"
                  style={{
                    fontSize: 10, fontWeight: 600, letterSpacing: 0.4, color: badgeColor,
                    border: `1px solid ${badgeColor}`, borderRadius: 999, padding: '1px 8px',
                  }}
                >
                  {badgeText}
                </span>
                <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>
                  {new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </span>
                {hasDetail && (
                  <Icon d={I.arrow} size={10} stroke={1.4} style={{ color: 'var(--ink-5)', transform: expanded ? 'rotate(90deg)' : 'none' }} />
                )}
              </button>

              {expanded && overridden && (
                <div style={{ padding: '0 16px 12px', fontSize: 11.5, color: 'var(--ink-4)', lineHeight: 1.5 }}>
                  {t('loops.override-reason')}: {loop.override_motivation}
                </div>
              )}

              {expanded && evidence && (
                <div style={{ padding: '0 16px 12px' }}>
                  {evidence.summary && (
                    <p style={{ margin: '0 0 8px', fontSize: 11.5, color: 'var(--ink-4)', lineHeight: 1.5 }}>{evidence.summary}</p>
                  )}
                  {Array.isArray(evidence.signals) && evidence.signals.length > 0 && (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                      <thead>
                        <tr>
                          {(['loops.col-signal', 'loops.col-value', 'loops.col-threshold', 'loops.col-verdict'] as MessageKey[]).map((k) => (
                            <th key={k} className="lp-mono" style={{ textAlign: 'left', padding: '4px 6px', fontSize: 9.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--ink-5)', borderBottom: '1px solid var(--line)' }}>
                              {t(k)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {evidence.signals.map((s) => (
                          <tr key={s.signal}>
                            <td style={{ padding: '4px 6px', color: 'var(--ink-2)' }}>
                              {SIGNAL_LABEL_KEY[s.signal] ? t(SIGNAL_LABEL_KEY[s.signal]) : s.signal.replace(/_/g, ' ')}
                            </td>
                            <td className="lp-mono" style={{ padding: '4px 6px', color: 'var(--ink-2)' }}>{pct(s.value)}</td>
                            <td className="lp-mono" style={{ padding: '4px 6px', color: 'var(--ink-5)' }}>≥ {pct(s.threshold)}</td>
                            <td className="lp-mono" style={{ padding: '4px 6px', color: s.passed ? 'var(--moss)' : 'var(--clay)' }}>
                              {s.passed ? '✓' : '✗'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {typeof evidence.interviews === 'number' && (
                    <p className="lp-mono" style={{ margin: '8px 0 0', fontSize: 10, color: 'var(--ink-5)' }}>
                      {t('loops.evidence-base', { interviews: evidence.interviews, iterations: evidence.iterations ?? loop.iteration })}
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default LoopHistoryCard;
