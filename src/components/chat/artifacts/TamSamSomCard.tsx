'use client';

import type { TamSamSomArtifact, MarketSizeTier } from '@/types/artifacts';
import type { MessageKey } from '@/lib/i18n/messages';
import { useT } from '@/components/providers/LocaleProvider';
import ArtifactCardShell from './ArtifactCardShell';

interface TamSamSomCardProps {
  artifact: TamSamSomArtifact;
}

const CONFIDENCE_KEY: Record<NonNullable<MarketSizeTier['confidence']>, MessageKey> = {
  low:    'tss.confidence-low',
  medium: 'tss.confidence-medium',
  high:   'tss.confidence-high',
};

/**
 * TODO(user): Tune concentric circle radii from numeric_usd values.
 *
 * The default below uses square-root scaling so a 10× market shows as ~3.16×
 * the radius — visually honest because perceived area scales with radius².
 *
 * Alternatives to consider:
 *  - Linear scaling (radius ∝ value) — exaggerates differences, visually
 *    misleading but emphasizes how small SOM is vs TAM.
 *  - Log scaling — useful when TAM is 1000× SOM and linear would crush SOM
 *    into a dot.
 *  - Fixed ratios (e.g., 100%/40%/15%) — ignores actual numbers, just
 *    communicates the funnel concept.
 *
 * The choice teaches founders how to read magnitude. Square-root is the
 * cartographically correct default — alternatives are editorial choices.
 *
 * Constraints:
 *  - Inputs are positive USD numbers (or undefined if agent couldn't parse).
 *  - Return percentages 0-100. The largest tier should be 100.
 *  - If any tier is missing numeric_usd, fall back to {tam:100, sam:60, som:25}.
 */
function tierRadiusPercent(tam?: number, sam?: number, som?: number): { tam: number; sam: number; som: number } {
  // TODO: tune
  if (!tam || !sam || !som) return { tam: 100, sam: 60, som: 25 };
  const scale = (v: number) => Math.sqrt(v / tam) * 100;
  return { tam: 100, sam: scale(sam), som: scale(som) };
}

function Tier({ label, tier, className }: { label: string; tier: MarketSizeTier; className?: string }) {
  const t = useT();
  return (
    <div className={`flex flex-col gap-0.5 ${className || ''}`}>
      <div className="flex items-baseline gap-2">
        <span className="text-[10px] uppercase tracking-wider text-ink-5 font-mono">{label}</span>
        <span className="text-sm font-semibold text-ink">{tier.value}</span>
        {tier.confidence && (
          <span className="text-[10px] text-ink-5 font-mono">
            {t(CONFIDENCE_KEY[tier.confidence])}
          </span>
        )}
      </div>
      {tier.methodology && (
        <p className="text-xs text-ink-4 leading-snug">{tier.methodology}</p>
      )}
    </div>
  );
}

export default function TamSamSomCard({ artifact }: TamSamSomCardProps) {
  const t = useT();
  const radii = tierRadiusPercent(
    artifact.tam.numeric_usd,
    artifact.sam.numeric_usd,
    artifact.som.numeric_usd,
  );

  return (
    <ArtifactCardShell
      typeLabel={t('tss.type-market-size')}
      title={artifact.title}
      sources={artifact.sources}
      provenance={artifact.provenance}
      aiGenerated
    >
      <div className="flex gap-4 items-center">
        {/* Concentric visual */}
        <div className="relative w-32 h-32 shrink-0">
          <div
            className="absolute inset-0 m-auto rounded-full border-2 border-sky bg-sky-wash flex items-center justify-center"
            style={{ width: `${radii.tam}%`, height: `${radii.tam}%` }}
          >
            <div
              className="rounded-full border-2 border-plum bg-plum-wash flex items-center justify-center"
              style={{ width: `${(radii.sam / radii.tam) * 100}%`, height: `${(radii.sam / radii.tam) * 100}%` }}
            >
              <div
                className="rounded-full border-2 border-accent bg-accent-wash"
                style={{ width: `${(radii.som / radii.sam) * 100}%`, height: `${(radii.som / radii.sam) * 100}%` }}
              />
            </div>
          </div>
        </div>

        {/* Tier details */}
        <div className="flex-1 space-y-2 min-w-0">
          <Tier label="TAM" tier={artifact.tam} />
          <Tier label="SAM" tier={artifact.sam} />
          <Tier label="SOM" tier={artifact.som} />
          {(artifact.timeframe || artifact.market_share_implied) && (
            <div className="text-xs text-ink-4 pt-1 border-t border-line-2">
              {artifact.timeframe && <>{t('tss.timeframe')}{artifact.timeframe}</>}
              {artifact.timeframe && artifact.market_share_implied && ' · '}
              {artifact.market_share_implied && <>{t('tss.implied-share')}{artifact.market_share_implied}</>}
            </div>
          )}
        </div>
      </div>
    </ArtifactCardShell>
  );
}
