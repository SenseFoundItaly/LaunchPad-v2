'use client';

import type { MonitorAlert, MonitorType } from '@/types';

const SEVERITY_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  critical: {
    bg: 'bg-red-500/10 border-red-500/30',
    text: 'text-red-400',
    label: 'Critical',
  },
  warning: {
    bg: 'bg-yellow-500/10 border-yellow-500/30',
    text: 'text-yellow-400',
    label: 'Warning',
  },
  info: {
    bg: 'bg-zinc-800/50 border-zinc-700/50',
    text: 'text-zinc-400',
    label: 'Info',
  },
};

const TYPE_COLORS: Record<MonitorType, string> = {
  health: 'text-green-400',
  competitor: 'text-red-400',
  market: 'text-blue-400',
  news: 'text-purple-400',
};

interface SignalTimelineProps {
  alerts: MonitorAlert[];
  onDismiss: (alertId: string) => void;
}

export default function SignalTimeline({ alerts, onDismiss }: SignalTimelineProps) {
  const activeAlerts = alerts.filter((a) => !a.dismissed);

  if (activeAlerts.length === 0) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center">
        <p className="text-zinc-500 text-sm">No signals yet.</p>
        <p className="text-zinc-600 text-xs mt-1">
          Run your monitors to start receiving alerts and insights.
        </p>
      </div>
    );
  }

  function formatTimestamp(dateStr: string): string {
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

  return (
    <div className="space-y-2">
      {activeAlerts.map((alert) => {
        const severity = SEVERITY_STYLES[alert.severity] || SEVERITY_STYLES.info;
        const monitorColor = alert.monitor_type
          ? TYPE_COLORS[alert.monitor_type] || 'text-zinc-400'
          : 'text-zinc-400';

        return (
          <div
            key={alert.alert_id}
            className={`border rounded-xl p-4 ${severity.bg}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <span
                    className={`text-xs font-medium px-1.5 py-0.5 rounded ${severity.text} bg-black/20`}
                  >
                    {severity.label}
                  </span>
                  {alert.monitor_name && (
                    <span className={`text-xs ${monitorColor}`}>
                      {alert.monitor_name}
                    </span>
                  )}
                  <span className="text-xs text-zinc-600">
                    {formatTimestamp(alert.created_at)}
                  </span>
                </div>
                <p className="text-sm text-zinc-200 leading-relaxed">
                  {alert.message}
                </p>
                {alert.details && (
                  <p className="text-xs text-zinc-500 mt-1.5 leading-relaxed">
                    {alert.details}
                  </p>
                )}
              </div>
              <button
                onClick={() => onDismiss(alert.alert_id)}
                className="text-zinc-600 hover:text-zinc-400 transition-colors shrink-0 p-1"
                aria-label="Dismiss alert"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M10.5 3.5L3.5 10.5M3.5 3.5L10.5 10.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
