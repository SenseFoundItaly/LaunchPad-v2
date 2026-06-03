'use client';

import type { IdeaCanvasArtifact } from '@/types/artifacts';
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
  return (
    <ArtifactCardShell
      typeLabel="Lean Canvas"
      title={artifact.title}
      sources={artifact.sources}
      aiGenerated
    >
      {/* Lean Canvas layout — 5 cols × 3 rows, value prop centered */}
      <div className="grid grid-cols-5 gap-1.5">
        <Block label="Problem" text={artifact.problem} />
        <Block label="Solution" text={artifact.solution} />
        <Block
          label="Value Proposition"
          text={artifact.value_proposition}
          className="row-span-2"
        />
        <Block label="Unfair Advantage" text={artifact.unfair_advantage} />
        <Block label="Target Market" text={artifact.target_market} />

        <Block label="Key Metrics" items={artifact.key_metrics} />
        <Block label="Channels" text={artifact.competitive_advantage} />
        {/* Value Prop spans row from above */}
        <Block label="Business Model" text={artifact.business_model} />

        <Block label="Cost Structure" items={artifact.cost_structure} className="col-span-2" />
        <Block label="Revenue Streams" items={artifact.revenue_streams} className="col-span-3" />
      </div>
    </ArtifactCardShell>
  );
}
