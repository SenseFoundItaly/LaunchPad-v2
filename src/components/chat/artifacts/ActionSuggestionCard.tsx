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
    <div className="my-3 bg-zinc-800/50 border border-zinc-700 rounded-lg p-4">
      <h4 className="text-sm font-semibold text-zinc-100 mb-1">{artifact.title}</h4>
      <p className="text-sm text-zinc-300 mb-3">{artifact.description}</p>
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
        className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg transition-all duration-200 hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
      >
        {artifact.action_label}
      </button>
    </div>
  );
}
