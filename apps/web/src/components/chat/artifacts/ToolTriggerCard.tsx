'use client';

import { useState } from 'react';
import type { ToolTrigger } from '@/types/artifacts';

interface ToolTriggerCardProps {
  artifact: ToolTrigger;
  onAction: (action: string, payload: Record<string, unknown>) => void;
  projectId?: string;
}

export default function ToolTriggerCard({ artifact, onAction, projectId }: ToolTriggerCardProps) {
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; draftId?: string; error?: string } | null>(null);

  async function handleExecute() {
    setExecuting(true);
    setResult(null);

    try {
      const res = await fetch('/api/tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool_name: artifact.tool_name,
          params: artifact.params,
          project_id: projectId,
        }),
      });
      const data = await res.json();

      if (data.success) {
        setResult({ success: true, draftId: data.data?.draftId });
        onAction('tool-executed', {
          tool_name: artifact.tool_name,
          draft_id: data.data?.draftId,
          result: data.data,
        });
      } else {
        setResult({ success: false, error: data.error || 'Execution failed' });
      }
    } catch (err) {
      setResult({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setExecuting(false);
    }
  }

  const iconMap: Record<string, string> = {
    'generate-landing-page': '\u{1F310}',
    'generate-pitch-deck': '\u{1F4CA}',
    'generate-one-pager': '\u{1F4C4}',
    'iterate-draft': '\u{1F504}',
    'publish-to-daytona': '\u{1F680}',
    'claude-code-execute': '\u{2699}\u{FE0F}',
  };

  return (
    <div className="border border-indigo-200 rounded-lg p-4 bg-indigo-50/50 my-2">
      <div className="flex items-start gap-3">
        <span className="text-2xl">{iconMap[artifact.tool_name] || '\u{1F527}'}</span>
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-gray-900 text-sm">{artifact.label}</h4>
          <p className="text-gray-600 text-xs mt-0.5">{artifact.description}</p>
          {result && (
            <div className={`mt-2 text-xs px-2 py-1 rounded ${result.success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
              {result.success
                ? `Done! ${result.draftId ? 'Draft created.' : 'Completed.'}`
                : `Error: ${result.error}`}
              {result.draftId && (
                <a href={`?draft=${result.draftId}`} className="ml-2 underline font-medium">
                  View Draft
                </a>
              )}
            </div>
          )}
        </div>
        <button
          onClick={handleExecute}
          disabled={executing}
          className="shrink-0 px-3 py-1.5 text-xs font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {executing ? 'Running...' : 'Execute'}
        </button>
      </div>
    </div>
  );
}
