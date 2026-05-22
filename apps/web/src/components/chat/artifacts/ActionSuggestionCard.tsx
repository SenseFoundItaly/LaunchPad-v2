'use client';

import type { ActionSuggestion } from '@/types/artifacts';

interface ActionSuggestionCardProps {
  artifact: ActionSuggestion;
  onAction: (action: string, payload: Record<string, unknown>) => void;
}

export default function ActionSuggestionCard({
  artifact,
  onAction,
}: ActionSuggestionCardProps) {
  return (
    <div className="my-3 bg-paper-3/50 border border-line-2 rounded-lg p-4">
      <h4 className="text-sm font-semibold text-ink mb-1">{artifact.title}</h4>
      <p className="text-sm text-ink-3 mb-3">{artifact.description}</p>
      <button
        type="button"
        onClick={() =>
          onAction('trigger-action', {
            title: artifact.title,
            description: artifact.description,
            action_label: artifact.action_label,
            action_type: artifact.action_type,
            action_payload: artifact.action_payload ?? {},
          })
        }
        className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-ink bg-moss rounded-lg transition-all duration-200 hover:bg-moss/80 focus:outline-none focus:ring-2 focus:ring-moss/40"
      >
        {artifact.action_label}
      </button>
    </div>
  );
}
