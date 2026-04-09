'use client';

import { use, useEffect, useState, useCallback } from 'react';
import api from '@/api';
import MonitorCard from '@/components/dashboard/MonitorCard';
import SignalTimeline from '@/components/dashboard/SignalTimeline';
import type {
  Monitor,
  MonitorAlert,
  MetricDefinition,
  BurnRate,
  DashboardData,
  ApiResponse,
} from '@/types';

export default function DashboardPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);

  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [alerts, setAlerts] = useState<MonitorAlert[]>([]);
  const [metrics, setMetrics] = useState<MetricDefinition[]>([]);
  const [burnRate, setBurnRate] = useState<BurnRate | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchMonitors = useCallback(async () => {
    try {
      const { data } = await api.get<ApiResponse<Monitor[]>>(
        `/api/projects/${projectId}/monitors`,
      );
      if (data.data) setMonitors(data.data);
    } catch {
      // Monitors may not exist yet
    }
  }, [projectId]);

  const fetchAlerts = useCallback(async () => {
    try {
      const { data } = await api.get<ApiResponse<MonitorAlert[]>>(
        `/api/projects/${projectId}/monitors/alerts`,
      );
      if (data.data) setAlerts(data.data);
    } catch {
      // No alerts yet
    }
  }, [projectId]);

  const fetchDashboard = useCallback(async () => {
    try {
      const { data } = await api.get<ApiResponse<DashboardData>>(
        `/api/dashboard/${projectId}`,
      );
      if (data.data) {
        setMetrics(data.data.metrics || []);
        setBurnRate(data.data.burn_rate || null);
      }
    } catch {
      // Dashboard may not exist yet
    }
  }, [projectId]);

  useEffect(() => {
    Promise.all([fetchMonitors(), fetchAlerts(), fetchDashboard()]).finally(() =>
      setLoading(false),
    );
  }, [fetchMonitors, fetchAlerts, fetchDashboard]);

  async function handleRunMonitor(monitorId: string) {
    try {
      await api.post(`/api/projects/${projectId}/monitors/${monitorId}/run`);
      // Refresh monitors and alerts after a short delay to allow the run to complete
      setTimeout(() => {
        fetchMonitors();
        fetchAlerts();
      }, 5000);
    } catch (err) {
      console.error('Failed to run monitor:', err);
    }
  }

  async function handleDismissAlert(alertId: string) {
    try {
      await api.post(`/api/projects/${projectId}/monitors/alerts`, {
        action: 'dismiss',
        alert_id: alertId,
      });
      setAlerts((prev) =>
        prev.map((a) => (a.alert_id === alertId ? { ...a, dismissed: true } : a)),
      );
    } catch (err) {
      console.error('Failed to dismiss alert:', err);
    }
  }

  // Derived values
  const runway =
    burnRate && burnRate.monthly_burn > 0
      ? Math.round(burnRate.cash_on_hand / burnRate.monthly_burn)
      : null;

  function getLatestValue(metric: MetricDefinition): number | null {
    if (!metric.entries || metric.entries.length === 0) return null;
    return metric.entries[metric.entries.length - 1].value;
  }

  function getGrowthRate(metric: MetricDefinition): number | null {
    if (!metric.entries || metric.entries.length < 2) return null;
    const latest = metric.entries[metric.entries.length - 1].value;
    const previous = metric.entries[metric.entries.length - 2].value;
    if (previous === 0) return null;
    return Math.round(((latest - previous) / previous) * 100);
  }

  function renderSparkline(entries: { value: number }[]) {
    if (!entries || entries.length < 2) return null;
    const values = entries.slice(-10).map((e) => e.value);
    const max = Math.max(...values);
    const min = Math.min(...values);
    const range = max - min || 1;
    const width = 64;
    const height = 20;
    const points = values
      .map(
        (v, i) =>
          `${(i / (values.length - 1)) * width},${height - ((v - min) / range) * height}`,
      )
      .join(' ');

    return (
      <svg width={width} height={height} className="inline-block" aria-hidden="true">
        <polyline fill="none" stroke="#3b82f6" strokeWidth="1.5" points={points} />
      </svg>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
        Loading dashboard...
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-white">Command Center</h3>
        </div>

        {/* Top Row: Runway + Metric Sparklines */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          {/* Runway Widget */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <div className="text-xs text-zinc-500 uppercase tracking-wider mb-2">
              Runway
            </div>
            <div
              className={`text-3xl font-bold ${
                runway !== null && runway < 6
                  ? 'text-red-400'
                  : runway !== null && runway < 12
                    ? 'text-yellow-400'
                    : 'text-green-400'
              }`}
            >
              {runway !== null ? `${runway}mo` : '--'}
            </div>
            {burnRate && (
              <div className="text-xs text-zinc-500 mt-1">
                ${burnRate.monthly_burn.toLocaleString()}/mo burn
              </div>
            )}
          </div>

          {/* Metric Sparklines (up to 3) */}
          {metrics.slice(0, 3).map((metric) => {
            const latest = getLatestValue(metric);
            const growth = getGrowthRate(metric);
            return (
              <div
                key={metric.metric_id}
                className="bg-zinc-900 border border-zinc-800 rounded-xl p-5"
              >
                <div className="text-xs text-zinc-500 uppercase tracking-wider mb-2">
                  {metric.name}
                </div>
                <div className="flex items-end justify-between">
                  <div>
                    <div className="text-xl font-bold text-white">
                      {latest !== null
                        ? metric.type === 'currency'
                          ? `$${latest.toLocaleString()}`
                          : metric.type === 'percentage'
                            ? `${latest}%`
                            : latest.toLocaleString()
                        : '--'}
                    </div>
                    {growth !== null && (
                      <span
                        className={`text-xs font-medium ${
                          growth >= 0 ? 'text-green-400' : 'text-red-400'
                        }`}
                      >
                        {growth >= 0 ? '+' : ''}
                        {growth}%
                      </span>
                    )}
                  </div>
                  {renderSparkline(metric.entries || [])}
                </div>
              </div>
            );
          })}

          {/* Placeholder when no metrics exist */}
          {metrics.length === 0 && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 md:col-span-3">
              <div className="text-xs text-zinc-500">
                Add metrics to track key numbers here.
              </div>
            </div>
          )}
        </div>

        {/* Monitor Cards */}
        <div className="mb-6">
          <h4 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">
            Monitors
          </h4>
          {monitors.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {monitors.map((monitor) => (
                <MonitorCard
                  key={monitor.monitor_id}
                  monitor={monitor}
                  onRun={handleRunMonitor}
                />
              ))}
            </div>
          ) : (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center">
              <p className="text-zinc-500 text-sm">No monitors configured.</p>
              <p className="text-zinc-600 text-xs mt-1">
                Monitors are created automatically when you start a new project.
              </p>
            </div>
          )}
        </div>

        {/* Signal Timeline */}
        <div>
          <h4 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">
            Signal Feed
          </h4>
          <SignalTimeline alerts={alerts} onDismiss={handleDismissAlert} />
        </div>
      </div>
    </div>
  );
}
