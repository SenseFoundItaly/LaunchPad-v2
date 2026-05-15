'use client';

import type { OptionSet } from '@/types/artifacts';

interface OptionSetCardProps {
  artifact: OptionSet;
  onAction: (action: string, payload: Record<string, unknown>) => void | Promise<void>;
}

export default function OptionSetCard({ artifact, onAction }: OptionSetCardProps) {
  return (
    <div className="my-3">
      <p className="text-sm text-ink-4 mb-2">{artifact.prompt}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {artifact.options.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() =>
              onAction('select-option', { optionId: option.id, label: option.label })
            }
            className="text-left bg-paper-2/50 border border-line-2 rounded-lg p-3 transition-all duration-200 hover:border-moss hover:bg-paper-2 focus:outline-none focus:ring-2 focus:ring-moss/40"
          >
            <span className="block text-sm font-medium text-ink-2">{option.label}</span>
            <span className="block text-xs text-ink-4 mt-1">{option.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
