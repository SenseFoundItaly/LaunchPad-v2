'use client';

import type { IdeaCanvasArtifact } from '@/types/artifacts';
import { useT } from '@/components/providers/LocaleProvider';
import ArtifactCardShell from './ArtifactCardShell';

interface IdeaCanvasCardProps {
  artifact: IdeaCanvasArtifact;
}

function Block({
  label,
  text,
  items,
  className,
}: {
  label: string;
  text?: string;
  items?: string[];
  className?: string;
}) {
  const isEmpty = !text && (!items || items.length === 0);
  return (
    <div className={`border border-line-2 rounded p-2 ${className || ''}`}>
      <div className="text-[10px] uppercase tracking-wider text-ink-5 font-mono mb-1">
        {label}
      </div>
      {isEmpty ? (
        <div className="text-xs text-ink-5 italic">—</div>
      ) : text ? (
        <p className="text-sm text-ink-3 leading-snug">{text}</p>
      ) : (
        <ul className="text-sm text-ink-3 space-y-0.5 list-disc list-inside marker:text-ink-5">
          {items!.map((it, i) => (
            <li key={i} className="leading-snug">{it}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function IdeaCanvasCard({ artifact }: IdeaCanvasCardProps) {
  const t = useT();
  return (
    <ArtifactCardShell
      typeLabel={t('iccard.type-lean-canvas')}
      title={artifact.title}
      sources={artifact.sources}
      aiGenerated
    >
      {/* Lean Canvas layout — 5 cols × 3 rows, value prop centered */}
      <div className="grid grid-cols-5 gap-1.5">
        <Block label={t('canvas.field-problem')} text={artifact.problem} />
        <Block label={t('canvas.field-solution')} text={artifact.solution} />
        <Block
          label={t('canvas.field-value')}
          text={artifact.value_proposition}
          className="row-span-2"
        />
        <Block label={t('iccard.unfair')} text={artifact.unfair_advantage} />
        <Block label={t('canvas.field-target')} text={artifact.target_market} />

        <Block label={t('canvas.field-metrics')} items={artifact.key_metrics} />
        <Block label={t('canvas.field-channels')} text={artifact.channels} />
        {/* Value Prop spans row from above */}
        <Block label={t('canvas.field-business-model')} text={artifact.business_model} />
        <Block label={t('canvas.field-edge')} text={artifact.competitive_advantage} />

        <Block label={t('canvas.field-costs')} items={artifact.cost_structure} className="col-span-2" />
        <Block label={t('canvas.field-revenues')} items={artifact.revenue_streams} className="col-span-3" />
      </div>
    </ArtifactCardShell>
  );
}
