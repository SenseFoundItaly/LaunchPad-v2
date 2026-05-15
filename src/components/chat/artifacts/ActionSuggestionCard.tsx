'use client';

import type { ActionSuggestion } from '@/types/artifacts';
import ArtifactCardShell from './ArtifactCardShell';

interface ActionSuggestionCardProps {
  artifact: ActionSuggestion;
  onAction: (action: string, payload: Record<string, unknown>) => void | Promise<void>;
}

export default function ActionSuggestionCard({
  artifact,
  onAction,
}: ActionSuggestionCardProps) {
  return (
    <ArtifactCardShell
      typeLabel="Action"
      title={artifact.title}
      sources={artifact.sources}
    >
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
        className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-moss rounded-lg transition-all duration-200 hover:bg-moss/80 focus:outline-none focus:ring-2 focus:ring-moss/40"
      >
        {artifact.action_label}
      </button>
    </ArtifactCardShell>
  );
}
