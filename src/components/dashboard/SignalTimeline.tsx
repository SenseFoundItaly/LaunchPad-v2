'use client';

import { useState } from 'react';
import api from '@/api';

interface Alert {
  id: string;
  type: string;
  severity: string;
  message: string;
  created_at: string;
}

const SEVERITY_STYLES: Record<string, { badge: string; border: string }> = {
  critical: { badge: 'bg-red-500/20 text-red-400', border: 'border-l-red-500' },
  warning: { badge: 'bg-yellow-500/20 text-yellow-400', border: 'border-l-yellow-500' },
  info: { badge: 'bg-zinc-700/50 text-zinc-400', border: 'border-l-zinc-600' },
  positive: { badge: 'bg-green-500/20 text-green-400', border: 'border-l-green-500' },
};

const TYPE_COLORS: Record<string, string> = {
  health: 'text-green-400',
  competitor: 'text-red-400',
  market: 'text-blue-400',
  news: 'text-purple-400',
  monitor: 'text-zinc-400',
};

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function SignalTimeline({
  alerts, projectId, onDismiss,
}: {
  alerts: Alert[];
  projectId: string;
  onDismiss?: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  async function dismiss(alertId: string) {
    try {
      await api.post(`/api/dashboard/${projectId}/alerts/${alertId}/dismiss`);
      onDismiss?.();
    } catch { /* ignore */ }
  }

  if (alerts.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-zinc-500">No signals yet</p>
        <p className="text-xs text-zinc-600 mt-1">Run a monitor to generate intelligence signals</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {alerts.map((alert) => {
        const sev = SEVERITY_STYLES[alert.severity] || SEVERITY_STYLES.info;
        const isExpanded = expanded === alert.id;
        const typeColor = TYPE_COLORS[alert.type] || 'text-zinc-400';

        return (
          <div key={alert.id} className={`border-l-2 ${sev.border} bg-zinc-900/50 rounded-r-lg overflow-hidden`}>
            <button
              onClick={() => setExpanded(isExpanded ? null : alert.id)}
              className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-zinc-800/30 transition-colors"
            >
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${sev.badge}`}>
                {alert.severity}
              </span>
              <span className={`text-[10px] shrink-0 ${typeColor}`}>{alert.type}</span>
              <span className="text-xs text-zinc-300 flex-1 truncate">{alert.message}</span>
              <span className="text-[10px] text-zinc-600 shrink-0">{timeAgo(alert.created_at)}</span>
              <span className="text-xs text-zinc-600">{isExpanded ? 'v' : '>'}</span>
            </button>

            {isExpanded && (
              <div className="px-4 pb-3 border-t border-zinc-800/50">
                <p className="text-xs text-zinc-300 leading-relaxed mt-2 whitespace-pre-wrap">{alert.message}</p>
                <div className="flex items-center justify-between mt-3">
                  <span className="text-[10px] text-zinc-600">{new Date(alert.created_at).toLocaleString()}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); dismiss(alert.id); }}
                    className="text-xs px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded-lg transition-colors"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
