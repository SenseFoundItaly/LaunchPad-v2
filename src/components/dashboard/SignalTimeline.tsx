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
  critical: { badge: 'bg-clay/20 text-clay', border: 'border-l-clay' },
  warning: { badge: 'bg-accent-wash text-accent', border: 'border-l-accent' },
  info: { badge: 'bg-paper-3/50 text-ink-4', border: 'border-l-ink-6' },
  positive: { badge: 'bg-moss-wash text-moss', border: 'border-l-moss' },
};

const TYPE_COLORS: Record<string, string> = {
  health: 'text-moss',
  competitor: 'text-clay',
  market: 'text-sky',
  news: 'text-plum',
  monitor: 'text-ink-4',
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
        <p className="text-sm text-ink-5">No signals yet</p>
        <p className="text-xs text-ink-6 mt-1">Run a monitor to generate intelligence signals</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {alerts.map((alert) => {
        const sev = SEVERITY_STYLES[alert.severity] || SEVERITY_STYLES.info;
        const isExpanded = expanded === alert.id;
        const typeColor = TYPE_COLORS[alert.type] || 'text-ink-4';

        return (
          <div key={alert.id} className={`border-l-2 ${sev.border} bg-paper/50 rounded-r-lg overflow-hidden`}>
            <button
              onClick={() => setExpanded(isExpanded ? null : alert.id)}
              className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-paper-2/30 transition-colors"
            >
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${sev.badge}`}>
                {alert.severity}
              </span>
              <span className={`text-[10px] shrink-0 ${typeColor}`}>{alert.type}</span>
              <span className="text-xs text-ink-3 flex-1 truncate">{alert.message}</span>
              <span className="text-[10px] text-ink-6 shrink-0">{timeAgo(alert.created_at)}</span>
              <span className="text-xs text-ink-6">{isExpanded ? 'v' : '>'}</span>
            </button>

            {isExpanded && (
              <div className="px-4 pb-3 border-t border-line">
                <p className="text-xs text-ink-3 leading-relaxed mt-2 whitespace-pre-wrap">{alert.message}</p>
                <div className="flex items-center justify-between mt-3">
                  <span className="text-[10px] text-ink-6">{new Date(alert.created_at).toLocaleString()}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); dismiss(alert.id); }}
                    className="text-xs px-3 py-1 bg-paper-2 hover:bg-paper-3 text-ink-4 rounded-lg transition-colors"
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
