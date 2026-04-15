'use client';

import { use, useEffect, useState, useCallback } from 'react';
import api from '@/api';
import { useTaskPolling } from '@/hooks/useTaskPolling';
import MonitorCard from '@/components/dashboard/MonitorCard';
import SignalTimeline from '@/components/dashboard/SignalTimeline';
import type {
  MetricDefinition,
  BurnRate,
  Alert,
  DashboardData,
  HealthAnalysis,
  ApiResponse,
} from '@/types';

interface Monitor {
  id: string;
  type: string;
  name: string;
  schedule: string;
  status: string;
  last_run: string | null;
  last_result: string | null;
}

export default function DashboardPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);

  const [metrics, setMetrics] = useState<MetricDefinition[]>([]);
  const [burnRate, setBurnRate] = useState<BurnRate | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [analysis, setAnalysis] = useState<HealthAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [taskId, setTaskId] = useState<string | null>(null);
  const { task } = useTaskPolling(taskId);

  // Forms
  const [showMetricForm, setShowMetricForm] = useState(false);
  const [metricForm, setMetricForm] = useState<{ name: string; type: MetricDefinition['type']; target_growth_rate: number }>({ name: '', type: 'count', target_growth_rate: 10 });
  const [burnForm, setBurnForm] = useState({ monthly_burn: 0, cash_on_hand: 0 });
  const [showBurnForm, setShowBurnForm] = useState(false);

  const fetchDashboard = useCallback(async () => {
    try {
      const { data } = await api.get<ApiResponse<DashboardData>>(`/api/dashboard/${projectId}`);
      if (data.data) {
        setMetrics(data.data.metrics || []);
        setBurnRate(data.data.burn_rate || null);
        setAlerts(data.data.alerts || []);
      }
    } catch {
      // Dashboard may not exist yet
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const fetchAnalysis = useCallback(async () => {
    try {
      const { data } = await api.get<ApiResponse<HealthAnalysis>>(`/api/dashboard/${projectId}/analysis`);
      if (data.data) {setAnalysis(data.data);}
    } catch {
      // No analysis yet
    }
  }, [projectId]);

  const fetchMonitors = useCallback(async () => {
    try {
      const { data } = await api.get<ApiResponse<Monitor[]>>(`/api/projects/${projectId}/monitors`);
      if (data.data) {setMonitors(data.data);}
    } catch {
      // No monitors yet
    }
  }, [projectId]);

  const [lastCronCheck, setLastCronCheck] = useState<Date | null>(null);

  useEffect(() => {
    fetchDashboard();
    fetchAnalysis();
    fetchMonitors();
  }, [fetchDashboard, fetchAnalysis, fetchMonitors]);

  // Auto-poll cron every 60 seconds to run due monitors
  useEffect(() => {
    async function checkCron() {
      try {
        const { data } = await api.get('/api/cron');
        setLastCronCheck(new Date());
        if (data.data?.ran > 0) {
          // Monitors ran — refresh dashboard data
          fetchDashboard();
          fetchMonitors();
        }
      } catch { /* ignore */ }
    }
    checkCron(); // Run immediately on mount
    const interval = setInterval(checkCron, 60000);
    return () => clearInterval(interval);
  }, [fetchDashboard, fetchMonitors]);

  useEffect(() => {
    if (task?.status === 'completed' && task.result) {
      setAnalysis(task.result as unknown as HealthAnalysis);
      setTaskId(null);
    }
  }, [task]);

  async function addMetric() {
    try {
      await api.post(`/api/dashboard/${projectId}/metrics`, metricForm);
      setShowMetricForm(false);
      setMetricForm({ name: '', type: 'count', target_growth_rate: 10 });
      fetchDashboard();
    } catch (err) {
      console.error('Failed to add metric:', err);
    }
  }

  async function saveBurnRate() {
    try {
      await api.post(`/api/dashboard/${projectId}/burn-rate`, burnForm);
      setShowBurnForm(false);
      fetchDashboard();
    } catch (err) {
      console.error('Failed to save burn rate:', err);
    }
  }

  async function dismissAlert(alertId: string) {
    try {
      await api.post(`/api/dashboard/${projectId}/alerts/${alertId}/dismiss`);
      setAlerts((prev) => prev.map((a) => (a.alert_id === alertId ? { ...a, dismissed: true } : a)));
    } catch (err) {
      console.error('Failed to dismiss alert:', err);
    }
  }

  async function runAnalysis() {
    setTaskId(null);
    try {
      const { data } = await api.post<ApiResponse<{ task_id: string }>>(`/api/dashboard/${projectId}/analyze`);
      if (data.success) {setTaskId(data.data.task_id);}
    } catch (err) {
      console.error('Failed to run analysis:', err);
    }
  }

  const isRunning = task?.status === 'processing' || task?.status === 'pending';
  const runway = burnRate && burnRate.monthly_burn > 0 ? Math.round(burnRate.cash_on_hand / burnRate.monthly_burn) : null;

  function getLatestValue(metric: MetricDefinition): number | null {
    if (!metric.entries || metric.entries.length === 0) {return null;}
    return metric.entries[metric.entries.length - 1].value;
  }

  function getGrowthRate(metric: MetricDefinition): number | null {
    if (!metric.entries || metric.entries.length < 2) {return null;}
    const latest = metric.entries[metric.entries.length - 1].value;
    const previous = metric.entries[metric.entries.length - 2].value;
    if (previous === 0) {return null;}
    return Math.round(((latest - previous) / previous) * 100);
  }

  function renderSparkline(entries: { value: number }[]) {
    if (!entries || entries.length < 2) {return null;}
    const values = entries.slice(-10).map((e) => e.value);
    const max = Math.max(...values);
    const min = Math.min(...values);
    const range = max - min || 1;
    const width = 80;
    const height = 24;
    const points = values
      .map((v, i) => `${(i / (values.length - 1)) * width},${height - ((v - min) / range) * height}`)
      .join(' ');

    return (
      <svg width={width} height={height} className="inline-block">
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
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowMetricForm(!showMetricForm)}
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-sm font-medium transition-colors"
            >
              + Add Metric
            </button>
            <button
              onClick={runAnalysis}
              disabled={isRunning}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {isRunning ? `Analyzing... ${task?.progress || 0}%` : 'Run AI Analysis'}
            </button>
          </div>
        </div>

        {/* Task Progress */}
        {isRunning && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-zinc-300">{task?.message || 'Running analysis...'}</span>
            </div>
            <div className="w-full h-2 bg-zinc-800 rounded-full">
              <div
                className="h-full bg-blue-500 rounded-full transition-all"
                style={{ width: `${task?.progress || 0}%` }}
              />
            </div>
          </div>
        )}

        {task?.status === 'failed' && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-6 text-red-400 text-sm">
            {task.error}
          </div>
        )}

        {/* Alerts */}
        {alerts.filter((a) => !a.dismissed).length > 0 && (
          <div className="space-y-2 mb-6">
            {alerts
              .filter((a) => !a.dismissed)
              .map((alert) => (
                <div
                  key={alert.alert_id}
                  className={`flex items-center justify-between rounded-xl p-4 text-sm ${
                    alert.severity === 'critical'
                      ? 'bg-red-500/10 border border-red-500/30 text-red-400'
                      : alert.severity === 'warning'
                        ? 'bg-yellow-500/10 border border-yellow-500/30 text-yellow-400'
                        : 'bg-blue-500/10 border border-blue-500/30 text-blue-400'
                  }`}
                >
                  <span>{alert.message}</span>
                  <button
                    onClick={() => dismissAlert(alert.alert_id)}
                    className="text-zinc-500 hover:text-zinc-300 ml-4"
                  >
                    Dismiss
                  </button>
                </div>
              ))}
          </div>
        )}

        {/* Add Metric Form */}
        {showMetricForm && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-6">
            <h4 className="text-sm font-medium text-white mb-4">Add New Metric</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Name</label>
                <input
                  type="text"
                  value={metricForm.name}
                  onChange={(e) => setMetricForm({ ...metricForm, name: e.target.value })}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                  placeholder="e.g., Monthly Revenue"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Type</label>
                <select
                  value={metricForm.type}
                  onChange={(e) => setMetricForm({ ...metricForm, type: e.target.value as MetricDefinition['type'] })}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="currency">Currency</option>
                  <option value="count">Count</option>
                  <option value="percentage">Percentage</option>
                  <option value="duration">Duration</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Target Growth Rate (%)</label>
                <input
                  type="number"
                  value={metricForm.target_growth_rate}
                  onChange={(e) => setMetricForm({ ...metricForm, target_growth_rate: Number(e.target.value) })}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setShowMetricForm(false)}
                className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={addMetric}
                disabled={!metricForm.name}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white rounded-lg text-sm font-medium transition-colors"
              >
                Add Metric
              </button>
            </div>
          </div>
        )}

        {/* Metrics Grid */}
        {metrics.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            {metrics.map((metric) => {
              const latest = getLatestValue(metric);
              const growth = getGrowthRate(metric);
              return (
                <div
                  key={metric.metric_id}
                  className="bg-zinc-900 border border-zinc-800 rounded-xl p-4"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-zinc-400 uppercase tracking-wider">{metric.name}</span>
                    <span className="text-xs text-zinc-600">{metric.type}</span>
                  </div>
                  <div className="flex items-end justify-between">
                    <div>
                      <div className="text-2xl font-bold text-white">
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
                  <div className="mt-2 text-xs text-zinc-500">
                    Target: {metric.target_growth_rate}% growth
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Burn Rate / Runway */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-sm font-medium text-white">Burn Rate & Runway</h4>
            <button
              onClick={() => {
                if (burnRate) {
                  setBurnForm({ monthly_burn: burnRate.monthly_burn, cash_on_hand: burnRate.cash_on_hand });
                }
                setShowBurnForm(!showBurnForm);
              }}
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              {showBurnForm ? 'Cancel' : 'Edit'}
            </button>
          </div>

          {showBurnForm ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Monthly Burn ($)</label>
                  <input
                    type="number"
                    value={burnForm.monthly_burn}
                    onChange={(e) => setBurnForm({ ...burnForm, monthly_burn: Number(e.target.value) })}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Cash on Hand ($)</label>
                  <input
                    type="number"
                    value={burnForm.cash_on_hand}
                    onChange={(e) => setBurnForm({ ...burnForm, cash_on_hand: Number(e.target.value) })}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  onClick={saveBurnRate}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  Save
                </button>
              </div>
            </div>
          ) : burnRate ? (
            <div className="grid grid-cols-3 gap-4">
              <div>
                <div className="text-xs text-zinc-400 mb-1">Monthly Burn</div>
                <div className="text-lg font-semibold text-white">
                  ${burnRate.monthly_burn.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-xs text-zinc-400 mb-1">Cash on Hand</div>
                <div className="text-lg font-semibold text-white">
                  ${burnRate.cash_on_hand.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-xs text-zinc-400 mb-1">Runway</div>
                <div
                  className={`text-lg font-semibold ${
                    runway !== null && runway < 6
                      ? 'text-red-400'
                      : runway !== null && runway < 12
                        ? 'text-yellow-400'
                        : 'text-green-400'
                  }`}
                >
                  {runway !== null ? `${runway} months` : '--'}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-zinc-500">
              No burn rate data yet. Click Edit to add your financials.
            </div>
          )}
        </div>

        {/* AI Analysis */}
        {analysis && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-6">
            <h4 className="text-sm font-medium text-white mb-4">AI Health Analysis</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div className="text-center">
                <div
                  className={`text-3xl font-bold ${
                    analysis.health_score >= 70
                      ? 'text-green-400'
                      : analysis.health_score >= 40
                        ? 'text-yellow-400'
                        : 'text-red-400'
                  }`}
                >
                  {analysis.health_score}
                </div>
                <div className="text-xs text-zinc-400 mt-1">Health Score</div>
              </div>
              <div className="text-center">
                <div className="text-sm font-medium text-white">{analysis.trajectory}</div>
                <div className="text-xs text-zinc-400 mt-1">Trajectory</div>
              </div>
              <div className="text-center">
                <div className="text-sm font-medium text-red-400">{analysis.top_concern}</div>
                <div className="text-xs text-zinc-400 mt-1">Top Concern</div>
              </div>
              <div className="text-center">
                <div className="text-sm font-medium text-green-400">{analysis.top_opportunity}</div>
                <div className="text-xs text-zinc-400 mt-1">Top Opportunity</div>
              </div>
            </div>
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
              <h5 className="text-xs font-medium text-blue-400 mb-1">Weekly Advice</h5>
              <p className="text-sm text-zinc-300">{analysis.weekly_advice}</p>
            </div>
          </div>
        )}

        {/* Monitors */}
        {monitors.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium text-white">Monitors</h4>
              {lastCronCheck && (
                <span className="text-[10px] text-zinc-600">
                  Auto-check: {Math.floor((Date.now() - lastCronCheck.getTime()) / 60000)}m ago
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {monitors.map((m) => (
                <MonitorCard
                  key={m.id}
                  monitor={m}
                  projectId={projectId}
                  onRunComplete={() => {
                    fetchMonitors();
                    fetchDashboard();
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Signal Timeline */}
        {alerts.length > 0 && (
          <div className="mb-6">
            <h4 className="text-sm font-medium text-white mb-3">Signal Timeline</h4>
            <SignalTimeline
              alerts={alerts}
              projectId={projectId}
              onDismiss={(alertId) => {
                setAlerts((prev) =>
                  prev.map((a) => (a.alert_id === alertId ? { ...a, dismissed: true } : a)),
                );
              }}
            />
          </div>
        )}

        {/* Empty State */}
        {metrics.length === 0 && !burnRate && !analysis && monitors.length === 0 && (
          <div className="text-center py-20 text-zinc-500">
            <p>Your command center is empty.</p>
            <p className="text-sm mt-1">
              Add metrics and burn rate data to track your startup health.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
