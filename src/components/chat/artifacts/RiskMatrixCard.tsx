'use client';

import { useState } from 'react';
import type { RiskMatrixArtifact, RiskScenarioEntry } from '@/types/artifacts';
import ArtifactCardShell from './ArtifactCardShell';

interface RiskMatrixCardProps {
  artifact: RiskMatrixArtifact;
}

type Zone = 'low' | 'medium' | 'high' | 'critical';

const ZONE_CLASS: Record<Zone, string> = {
  low:      'bg-moss-wash',
  medium:   'bg-cat-gold-wash',
  high:     'bg-accent-wash',
  critical: 'bg-cat-rose-wash',
};

const ZONE_DOT: Record<Zone, string> = {
  low:      'bg-moss text-paper',
  medium:   'bg-cat-gold text-paper',
  high:     'bg-accent text-paper',
  critical: 'bg-cat-rose text-paper',
};

/**
 * TODO(user): Map (probability, impact) → zone.
 *
 * Both axes are 1-5. The card renders a 5×5 grid where every cell gets a
 * background class via ZONE_CLASS[zone]. Each plotted risk also gets a colored
 * dot via ZONE_DOT[zone].
 *
 * This is a risk-philosophy decision, not boilerplate:
 *  - The naive mapping is multiplicative: risk_score = p × i, then
 *    >= 15 critical, 10-14 high, 5-9 medium, < 5 low. Clean math, but treats
 *    a 5×3 (very likely, moderate damage) the same as a 3×5 (occasional,
 *    catastrophic) — most founders care more about the catastrophic case.
 *  - A probability-weighted view bumps anything with probability ≥ 4 to at
 *    least high — reflecting "likely things will happen."
 *  - An impact-weighted view bumps anything with impact = 5 to critical
 *    regardless of probability — reflecting "we can't survive this one."
 *
 * Whichever rule you pick teaches the founder how to read the matrix. The
 * mapping you choose should be defensible to a risk-aware advisor or investor.
 *
 * Constraints:
 *  - probability and impact are integers 1-5 (validated by the skill schema)
 *  - return one of: 'low' | 'medium' | 'high' | 'critical'
 *  - keep it pure — no side effects, deterministic
 */
function riskZone(probability: number, impact: number): Zone {
  // TODO: implement
  const score = probability * impact;
  if (score >= 15) return 'critical';
  if (score >= 10) return 'high';
  if (score >= 5) return 'medium';
  return 'low';
}

const DIMENSION_LABEL: Record<RiskScenarioEntry['dimension'], string> = {
  market:      'Market',
  technical:   'Technical',
  regulatory:  'Regulatory',
  team:        'Team',
  financial:   'Financial',
  dependency:  'Dependency',
};

export default function RiskMatrixCard({ artifact }: RiskMatrixCardProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const risksByCell = new Map<string, RiskScenarioEntry[]>();
  for (const r of artifact.risks) {
    const key = `${r.probability}-${r.impact}`;
    const bucket = risksByCell.get(key) ?? [];
    bucket.push(r);
    risksByCell.set(key, bucket);
  }

  return (
    <ArtifactCardShell
      typeLabel="Risk Matrix"
      title={artifact.title}
      sources={artifact.sources}
      provenance={artifact.provenance}
      aiGenerated
    >
      {artifact.overall_assessment && (
        <p className="text-sm text-ink-3 mb-3">{artifact.overall_assessment}</p>
      )}

      {/* 5×5 grid — impact rows (5 at top) × probability cols (5 at right) */}
      <div className="flex gap-2 mb-3">
        {/* Y-axis label */}
        <div className="flex flex-col items-center justify-center pr-1">
          <span className="text-[10px] uppercase tracking-wider text-ink-5 font-mono [writing-mode:vertical-rl] rotate-180">
            Impact →
          </span>
        </div>

        <div className="flex-1">
          <div className="grid grid-cols-5 gap-px bg-line-2 border border-line-2 rounded">
            {[5, 4, 3, 2, 1].flatMap((impact) =>
              [1, 2, 3, 4, 5].map((probability) => {
                const zone = riskZone(probability, impact);
                const cellKey = `${probability}-${impact}`;
                const cellRisks = risksByCell.get(cellKey) ?? [];
                return (
                  <div
                    key={cellKey}
                    className={`${ZONE_CLASS[zone]} aspect-square flex items-center justify-center relative`}
                  >
                    {cellRisks.map((r, i) => (
                      <button
                        key={r.id}
                        type="button"
                        onMouseEnter={() => setHoveredId(r.id)}
                        onMouseLeave={() => setHoveredId(null)}
                        className={`${ZONE_DOT[riskZone(r.probability, r.impact)]} text-[10px] font-mono font-bold w-5 h-5 rounded-full flex items-center justify-center shadow-sm cursor-pointer transition-transform hover:scale-110 ${hoveredId === r.id ? 'ring-2 ring-ink' : ''}`}
                        style={{
                          position: cellRisks.length > 1 ? 'absolute' : 'static',
                          top: cellRisks.length > 1 ? `${20 + i * 14}%` : undefined,
                          left: cellRisks.length > 1 ? `${20 + i * 14}%` : undefined,
                        }}
                        aria-label={`${r.risk} — probability ${r.probability}, impact ${r.impact}`}
                      >
                        {artifact.risks.indexOf(r) + 1}
                      </button>
                    ))}
                  </div>
                );
              })
            )}
          </div>
          {/* X-axis label */}
          <div className="text-center text-[10px] uppercase tracking-wider text-ink-5 font-mono mt-1">
            Probability →
          </div>
        </div>
      </div>

      {/* Risk detail list */}
      <ol className="space-y-2 text-sm">
        {artifact.risks.map((r, i) => {
          const zone = riskZone(r.probability, r.impact);
          const isHovered = hoveredId === r.id;
          return (
            <li
              key={r.id}
              onMouseEnter={() => setHoveredId(r.id)}
              onMouseLeave={() => setHoveredId(null)}
              className={`border border-line-2 rounded p-2 transition-colors ${isHovered ? 'bg-paper-2' : ''}`}
            >
              <div className="flex items-start gap-2">
                <span className={`${ZONE_DOT[zone]} shrink-0 text-[10px] font-mono font-bold w-5 h-5 rounded-full flex items-center justify-center`}>
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[10px] uppercase tracking-wider text-ink-5 font-mono">
                      {DIMENSION_LABEL[r.dimension]}
                    </span>
                    <span className="text-[10px] text-ink-5 font-mono">
                      p{r.probability}·i{r.impact}
                      {r.risk_score !== undefined && ` = ${r.risk_score}`}
                    </span>
                  </div>
                  <div className="text-ink mb-1">{r.risk}</div>
                  {r.narrative && <p className="text-xs text-ink-4 mb-1">{r.narrative}</p>}
                  {r.mitigation && (
                    <p className="text-xs text-ink-3">
                      <span className="text-ink-5 font-mono uppercase tracking-wider text-[10px] mr-1">Mitigation:</span>
                      {r.mitigation}
                      {r.mitigation_owner && <span className="text-ink-5"> · {r.mitigation_owner}</span>}
                      {r.mitigation_due && <span className="text-ink-5"> · due {r.mitigation_due}</span>}
                    </p>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </ArtifactCardShell>
  );
}
