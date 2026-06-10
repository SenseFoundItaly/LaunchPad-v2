'use client';

import type { OptionSet } from '@/types/artifacts';
import { splitOptionLabel } from '@/components/chat/option-label';

interface OptionSetCardProps {
  artifact: OptionSet;
  onAction: (action: string, payload: Record<string, unknown>) => void | Promise<void>;
}

export default function OptionSetCard({ artifact, onAction }: OptionSetCardProps) {
  return (
    <div className="my-3">
      <p className="text-sm text-ink-4 mb-2">{artifact.prompt}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {artifact.options.map((option) => {
          // UI guardrail: paragraph-length labels get split (first clause →
          // label, remainder → description) and CSS-clamped so the options
          // read as buttons, not essays. Full text stays in the tooltip.
          const split = splitOptionLabel(option.label, option.description);
          return (
            <button
              key={option.id}
              type="button"
              title={split.full}
              onClick={() =>
                onAction('select-option', { optionId: option.id, label: split.label })
              }
              className="text-left min-w-0 bg-paper-2/50 border border-line-2 rounded-lg p-3 transition-all duration-200 hover:border-moss hover:bg-paper-2 focus:outline-none focus:ring-2 focus:ring-moss/40"
            >
              <span className="block text-sm font-medium text-ink-2 truncate">{split.label}</span>
              {split.description && (
                <span className="block text-xs text-ink-4 mt-1 line-clamp-2">{split.description}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
