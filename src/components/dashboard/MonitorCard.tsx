'use client';

import { useState, useRef } from 'react';

interface Monitor {
  id: string;
  type: string;
  name: string;
  schedule: string;
  status: string;
  last_run: string | null;
  last_result: string | null;
  prompt: string;
  config: string | null;
}

const TYPE_STYLES: Record<string, string> = {
  health: 'bg-green-500/20 text-green-400',
  competitor: 'bg-red-500/20 text-red-400',
  market: 'bg-blue-500/20 text-blue-400',
  news: 'bg-purple-500/20 text-purple-400',
};

function timeAgo(ts: string | null): string {
  if (!ts) return 'Never';
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function MonitorCard({
  monitor, projectId, onRunComplete, onConfigure,
}: {
  monitor: Monitor;
  projectId: string;
  onRunComplete?: () => void;
  onConfigure?: (monitor: Monitor) => void;
}) {
  const [running, setRunning] = useState(false);
  const [streamOutput, setStreamOutput] = useState('');
  const [showOutput, setShowOutput] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  async function handleRun() {
    setRunning(true);
    setStreamOutput('');
    setShowOutput(true);
    abortRef.current = new AbortController();

    try {
      const res = await fetch(`/api/projects/${projectId}/monitors/${monitor.id}/run`, {
        method: 'POST',
        signal: abortRef.current.signal,
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          for (const line of text.split('\n')) {
            if (line.startsWith('data: ')) {
              try {
                const parsed = JSON.parse(line.slice(6));
                if (parsed.content) {
                  setStreamOutput(prev => prev + parsed.content);
                }
                if (parsed.done) {
                  onRunComplete?.();
                }
              } catch { /* skip */ }
            }
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setStreamOutput(prev => prev + '\n[Error running monitor]');
      }
    } finally {
      setRunning(false);
    }
  }

  const badge = TYPE_STYLES[monitor.type] || 'bg-zinc-500/20 text-zinc-400';
  const preview = monitor.last_result?.slice(0, 200);

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <div className="p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badge}`}>{monitor.type}</span>
            <span className="text-[10px] text-zinc-600">{monitor.schedule}</span>
          </div>
          <span className={`text-[10px] font-medium ${monitor.status === 'active' ? 'text-green-400' : 'text-zinc-500'}`}>
            {monitor.status}
          </span>
        </div>

        <h4 className="text-sm font-medium text-white mb-1">{monitor.name}</h4>
        <p className="text-[10px] text-zinc-600 mb-2">Last run: {timeAgo(monitor.last_run)}</p>

        {/* Last result preview */}
        {preview && !showOutput && (
          <p className="text-xs text-zinc-500 mb-3 line-clamp-2">{preview}...</p>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleRun}
            disabled={running}
            className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-200 rounded-lg text-xs font-medium transition-colors"
          >
            {running ? (
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin" />
                Running...
              </span>
            ) : 'Run now'}
          </button>
          <button
            onClick={() => onConfigure?.(monitor)}
            className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded-lg text-xs transition-colors"
          >
            Configure
          </button>
          {showOutput && !running && (
            <button
              onClick={() => setShowOutput(false)}
              className="px-2 py-1.5 text-xs text-zinc-600 hover:text-zinc-400"
            >
              Hide
            </button>
          )}
        </div>
      </div>

      {/* Streaming output */}
      {showOutput && streamOutput && (
        <div className="border-t border-zinc-800 px-4 py-3 bg-zinc-950/50 max-h-64 overflow-y-auto">
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Output</div>
          <div className="text-xs text-zinc-300 whitespace-pre-wrap leading-relaxed">{streamOutput}</div>
        </div>
      )}
    </div>
  );
}
