'use client';

import { useState } from 'react';
import type { Monitor, MonitorType } from '@/types';

const TYPE_STYLES: Record<MonitorType, { border: string; badge: string; dot: string }> = {
  health: {
    border: 'border-green-500/30',
    badge: 'bg-green-500/10 text-green-400',
    dot: 'bg-green-400',
  },
  competitor: {
    border: 'border-red-500/30',
    badge: 'bg-red-500/10 text-red-400',
    dot: 'bg-red-400',
  },
  market: {
    border: 'border-blue-500/30',
    badge: 'bg-blue-500/10 text-blue-400',
    dot: 'bg-blue-400',
  },
  news: {
    border: 'border-purple-500/30',
    badge: 'bg-purple-500/10 text-purple-400',
    dot: 'bg-purple-400',
  },
};

interface MonitorCardProps {
  monitor: Monitor;
  onRun: (monitorId: string) => Promise<void>;
}

export default function MonitorCard({ monitor, onRun }: MonitorCardProps) {
  const [running, setRunning] = useState(false);
  const style = TYPE_STYLES[monitor.type] || TYPE_STYLES.health;

  async function handleRun() {
    setRunning(true);
    try {
      await onRun(monitor.monitor_id);
    } finally {
      // Keep running state for a brief moment to indicate the run was triggered
      setTimeout(() => setRunning(false), 3000);
    }
  }

  function formatRelativeTime(dateStr: string | null): string {
    if (!dateStr) return 'Never';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  }

  function formatFutureTime(dateStr: string | null): string {
    if (!dateStr) return '--';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();
    if (diffMs < 0) return 'Overdue';
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffHours / 24);

    if (diffHours < 1) return 'Soon';
    if (diffHours < 24) return `in ${diffHours}h`;
    if (diffDays < 7) return `in ${diffDays}d`;
    return date.toLocaleDateString();
  }

  return (
    <div className={`bg-zinc-900 border ${style.border} rounded-xl p-5`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${style.dot} ${monitor.enabled ? '' : 'opacity-30'}`} />
          <h4 className="text-sm font-medium text-white">{monitor.name}</h4>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full ${style.badge}`}>
          {monitor.type}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <div className="text-xs text-zinc-500 mb-0.5">Last run</div>
          <div className="text-sm text-zinc-300">
            {formatRelativeTime(monitor.last_run_at)}
          </div>
        </div>
        <div>
          <div className="text-xs text-zinc-500 mb-0.5">Next run</div>
          <div className="text-sm text-zinc-300">
            {formatFutureTime(monitor.next_run_at)}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-500 capitalize">{monitor.schedule}</span>
        <button
          onClick={handleRun}
          disabled={running}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            running
              ? 'bg-zinc-700 text-zinc-400 cursor-wait'
              : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200'
          }`}
        >
          {running ? 'Running...' : 'Run now'}
        </button>
      </div>
    </div>
  );
}
