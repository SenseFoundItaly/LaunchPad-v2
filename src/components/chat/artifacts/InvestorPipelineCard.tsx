'use client';

import type { InvestorPipelineArtifact, InvestorEntry, InvestorStage } from '@/types/artifacts';
import ArtifactCardShell from './ArtifactCardShell';

interface InvestorPipelineCardProps {
  artifact: InvestorPipelineArtifact;
}

const STAGE_ORDER: InvestorStage[] = ['target', 'contacted', 'meeting', 'interested', 'committed', 'passed'];

const STAGE_LABEL: Record<InvestorStage, string> = {
  target:     'Target',
  contacted:  'Contacted',
  meeting:    'Meeting',
  interested: 'Interested',
  committed:  'Committed',
  passed:     'Passed',
};

const STAGE_COLOR: Record<InvestorStage, string> = {
  target:     'border-ink-5/40 bg-paper-2/50',
  contacted:  'border-sky/40 bg-sky-wash/50',
  meeting:    'border-plum/40 bg-plum-wash/50',
  interested: 'border-cat-gold/40 bg-cat-gold-wash/50',
  committed:  'border-moss/40 bg-moss-wash/50',
  passed:     'border-line-2 bg-paper-2/30 opacity-60',
};

function formatCheck(amount?: number): string {
  if (!amount) return '';
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(amount % 1_000_000 === 0 ? 0 : 1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}k`;
  return `$${amount}`;
}

function InvestorCard({ investor }: { investor: InvestorEntry }) {
  return (
    <div className="bg-paper border border-line-2 rounded p-1.5 text-xs">
      <div className="flex items-baseline justify-between gap-1 mb-0.5">
        <span className="font-semibold text-ink truncate">{investor.name}</span>
        {investor.check_size && (
          <span className="text-ink-4 font-mono shrink-0">{formatCheck(investor.check_size)}</span>
        )}
      </div>
      {investor.type && (
        <div className="text-[10px] text-ink-5 font-mono uppercase tracking-wider">{investor.type}</div>
      )}
      {investor.next_step && (
        <div className="mt-1 text-ink-3 leading-snug">
          <span className="text-ink-5">Next: </span>{investor.next_step}
          {investor.next_step_date && <span className="text-ink-5"> · {investor.next_step_date}</span>}
        </div>
      )}
    </div>
  );
}

export default function InvestorPipelineCard({ artifact }: InvestorPipelineCardProps) {
  const byStage = new Map<InvestorStage, InvestorEntry[]>();
  for (const stage of STAGE_ORDER) byStage.set(stage, []);
  for (const inv of artifact.investors) {
    byStage.get(inv.stage)?.push(inv);
  }

  const committed = artifact.investors
    .filter(i => i.stage === 'committed')
    .reduce((sum, i) => sum + (i.check_size ?? 0), 0);

  const interested = artifact.investors
    .filter(i => i.stage === 'interested')
    .reduce((sum, i) => sum + (i.check_size ?? 0), 0);

  return (
    <ArtifactCardShell
      typeLabel="Pipeline"
      title={artifact.title}
      sources={artifact.sources}
      aiGenerated
    >
      {(artifact.round_target || artifact.round_type) && (
        <div className="flex items-center gap-3 mb-3 text-xs">
          {artifact.round_type && (
            <span className="text-ink-5 uppercase tracking-wider font-mono">{artifact.round_type}</span>
          )}
          {artifact.round_target && (
            <span className="text-ink-3">
              <span className="font-semibold text-ink">{formatCheck(committed)}</span>
              <span className="text-ink-5"> committed</span>
              {interested > 0 && (
                <>
                  <span className="text-ink-5"> · </span>
                  <span className="text-ink-4">{formatCheck(interested)} interested</span>
                </>
              )}
              <span className="text-ink-5"> of {formatCheck(artifact.round_target)}</span>
            </span>
          )}
          {artifact.target_close && (
            <span className="text-ink-5">Close by {artifact.target_close}</span>
          )}
        </div>
      )}

      <div className="grid grid-cols-6 gap-1.5">
        {STAGE_ORDER.map(stage => {
          const investors = byStage.get(stage) ?? [];
          return (
            <div key={stage} className={`border ${STAGE_COLOR[stage]} rounded p-1.5 min-h-[80px]`}>
              <div className="flex items-baseline justify-between mb-1.5">
                <span className="text-[10px] uppercase tracking-wider text-ink-5 font-mono">
                  {STAGE_LABEL[stage]}
                </span>
                <span className="text-[10px] text-ink-5 font-mono">{investors.length}</span>
              </div>
              <div className="space-y-1">
                {investors.map(inv => (
                  <InvestorCard key={inv.id} investor={inv} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </ArtifactCardShell>
  );
}
