'use client';

import { use, useEffect, useState, useCallback } from 'react';
import api from '@/api';
import { useTaskPolling } from '@/hooks/useTaskPolling';
import type {
  MetricDefinition,
  BurnRate,
  Alert,
  DashboardData,
  HealthAnalysis,
  ApiResponse,
} from '@/types';

// Icon components
function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}

function SparklesIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
    </svg>
  );
}

function XMarkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function ChartIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
    </svg>
  );
}

function BanknotesIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
    </svg>
  );
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
      if (data.data) setAnalysis(data.data);
    } catch {
      // No analysis yet
    }
  }, [projectId]);

  useEffect(() => {
    fetchDashboard();
    fetchAnalysis();
  }, [fetchDashboard, fetchAnalysis]);

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
      if (data.success) setTaskId(data.data.task_id);
    } catch (err) {
      console.error('Failed to run analysis:', err);
    }
  }

  const isRunning = task?.status === 'processing' || task?.status === 'pending';
  const runway = burnRate && burnRate.monthly_burn > 0 ? Math.round(burnRate.cash_on_hand / burnRate.monthly_burn) : null;

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
    const width = 80;
    const height = 24;
    const points = values
      .map((v, i) => `${(i / (values.length - 1)) * width},${height - ((v - min) / range) * height}`)
      .join(' ');

    return (
      <svg width={width} height={height} className="inline-block">
        <polyline fill="none" stroke="currentColor" strokeWidth="1.5" points={points} className="text-primary" />
      </svg>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-8">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Command Center</h1>
            <p className="mt-1 text-foreground-secondary">Track your startup health and key metrics</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowMetricForm(!showMetricForm)}
              className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-card-hover"
            >
              <PlusIcon className="h-4 w-4" />
              Add Metric
            </button>
            <button
              onClick={runAnalysis}
              disabled={isRunning}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              <SparklesIcon className="h-4 w-4" />
              {isRunning ? `Analyzing... ${task?.progress || 0}%` : 'AI Analysis'}
            </button>
          </div>
        </div>

        {/* Task Progress */}
        {isRunning && (
          <div className="mb-6 rounded-2xl border border-border bg-card p-6">
            <div className="mb-3 flex items-center gap-3">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <span className="text-sm text-foreground-secondary">{task?.message || 'Running analysis...'}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-background-secondary">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${task?.progress || 0}%` }}
              />
            </div>
          </div>
        )}

        {task?.status === 'failed' && (
          <div className="mb-6 rounded-2xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
            {task.error}
          </div>
        )}

        {/* Alerts */}
        {alerts.filter((a) => !a.dismissed).length > 0 && (
          <div className="mb-6 space-y-2">
            {alerts
              .filter((a) => !a.dismissed)
              .map((alert) => (
                <div
                  key={alert.alert_id}
                  className={`flex items-center justify-between rounded-xl border p-4 text-sm ${
                    alert.severity === 'critical'
                      ? 'border-danger/30 bg-danger/5 text-danger'
                      : alert.severity === 'warning'
                        ? 'border-warning/30 bg-warning/5 text-warning'
                        : 'border-info/30 bg-info/5 text-info'
                  }`}
                >
                  <span>{alert.message}</span>
                  <button
                    onClick={() => dismissAlert(alert.alert_id)}
                    className="ml-4 rounded-lg p-1 opacity-60 transition-opacity hover:opacity-100"
                  >
                    <XMarkIcon className="h-4 w-4" />
                  </button>
                </div>
              ))}
          </div>
        )}

        {/* Add Metric Form */}
        {showMetricForm && (
          <div className="mb-6 rounded-2xl border border-border bg-card p-6">
            <h3 className="mb-4 font-semibold text-foreground">Add New Metric</h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Name</label>
                <input
                  type="text"
                  value={metricForm.name}
                  onChange={(e) => setMetricForm({ ...metricForm, name: e.target.value })}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="e.g., Monthly Revenue"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Type</label>
                <select
                  value={metricForm.type}
                  onChange={(e) => setMetricForm({ ...metricForm, type: e.target.value as MetricDefinition['type'] })}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  <option value="currency">Currency</option>
                  <option value="count">Count</option>
                  <option value="percentage">Percentage</option>
                  <option value="duration">Duration</option>
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Target Growth (%)</label>
                <input
                  type="number"
                  value={metricForm.target_growth_rate}
                  onChange={(e) => setMetricForm({ ...metricForm, target_growth_rate: Number(e.target.value) })}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-3">
              <button
                onClick={() => setShowMetricForm(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-foreground-secondary transition-colors hover:text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={addMetric}
                disabled={!metricForm.name}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                Add Metric
              </button>
            </div>
          </div>
        )}

        {/* Metrics Grid */}
        {metrics.length > 0 && (
          <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {metrics.map((metric) => {
              const latest = getLatestValue(metric);
              const growth = getGrowthRate(metric);
              return (
                <div
                  key={metric.metric_id}
                  className="rounded-2xl border border-border bg-card p-5"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-sm font-medium text-foreground-secondary">{metric.name}</span>
                    <span className="rounded-full bg-background-secondary px-2 py-0.5 text-xs text-foreground-muted">{metric.type}</span>
                  </div>
                  <div className="flex items-end justify-between">
                    <div>
                      <div className="text-2xl font-bold text-foreground">
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
                          className={`text-sm font-medium ${
                            growth >= 0 ? 'text-success' : 'text-danger'
                          }`}
                        >
                          {growth >= 0 ? '+' : ''}
                          {growth}%
                        </span>
                      )}
                    </div>
                    {renderSparkline(metric.entries || [])}
                  </div>
                  <div className="mt-2 text-xs text-foreground-muted">
                    Target: {metric.target_growth_rate}% growth
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Burn Rate / Runway */}
        <div className="mb-6 rounded-2xl border border-border bg-card p-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                <BanknotesIcon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-semibold text-foreground">Burn Rate & Runway</h3>
            </div>
            <button
              onClick={() => {
                if (burnRate) {
                  setBurnForm({ monthly_burn: burnRate.monthly_burn, cash_on_hand: burnRate.cash_on_hand });
                }
                setShowBurnForm(!showBurnForm);
              }}
              className="text-sm font-medium text-primary transition-colors hover:text-primary-hover"
            >
              {showBurnForm ? 'Cancel' : 'Edit'}
            </button>
          </div>

          {showBurnForm ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground">Monthly Burn ($)</label>
                  <input
                    type="number"
                    value={burnForm.monthly_burn}
                    onChange={(e) => setBurnForm({ ...burnForm, monthly_burn: Number(e.target.value) })}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground">Cash on Hand ($)</label>
                  <input
                    type="number"
                    value={burnForm.cash_on_hand}
                    onChange={(e) => setBurnForm({ ...burnForm, cash_on_hand: Number(e.target.value) })}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  onClick={saveBurnRate}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
                >
                  Save
                </button>
              </div>
            </div>
          ) : burnRate ? (
            <div className="grid grid-cols-3 gap-6">
              <div>
                <div className="text-sm text-foreground-secondary">Monthly Burn</div>
                <div className="mt-1 text-xl font-semibold text-foreground">
                  ${burnRate.monthly_burn.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-sm text-foreground-secondary">Cash on Hand</div>
                <div className="mt-1 text-xl font-semibold text-foreground">
                  ${burnRate.cash_on_hand.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-sm text-foreground-secondary">Runway</div>
                <div
                  className={`mt-1 text-xl font-semibold ${
                    runway !== null && runway < 6
                      ? 'text-danger'
                      : runway !== null && runway < 12
                        ? 'text-warning'
                        : 'text-success'
                  }`}
                >
                  {runway !== null ? `${runway} months` : '--'}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-foreground-secondary">
              No burn rate data yet. Click Edit to add your financials.
            </p>
          )}
        </div>

        {/* AI Analysis */}
        {analysis && (
          <div className="mb-6 rounded-2xl border border-border bg-card p-6">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                <SparklesIcon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-semibold text-foreground">AI Health Analysis</h3>
            </div>
            <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
              <div className="rounded-xl bg-background-secondary p-4 text-center">
                <div
                  className={`text-3xl font-bold ${
                    analysis.health_score >= 70
                      ? 'text-success'
                      : analysis.health_score >= 40
                        ? 'text-warning'
                        : 'text-danger'
                  }`}
                >
                  {analysis.health_score}
                </div>
                <div className="mt-1 text-xs text-foreground-muted">Health Score</div>
              </div>
              <div className="rounded-xl bg-background-secondary p-4 text-center">
                <div className="font-medium text-foreground">{analysis.trajectory}</div>
                <div className="mt-1 text-xs text-foreground-muted">Trajectory</div>
              </div>
              <div className="rounded-xl bg-background-secondary p-4 text-center">
                <div className="font-medium text-danger">{analysis.top_concern}</div>
                <div className="mt-1 text-xs text-foreground-muted">Top Concern</div>
              </div>
              <div className="rounded-xl bg-background-secondary p-4 text-center">
                <div className="font-medium text-success">{analysis.top_opportunity}</div>
                <div className="mt-1 text-xs text-foreground-muted">Top Opportunity</div>
              </div>
            </div>
            <div className="rounded-xl bg-primary/5 border border-primary/20 p-4">
              <h4 className="mb-2 text-sm font-medium text-primary">Weekly Advice</h4>
              <p className="text-sm text-foreground-secondary">{analysis.weekly_advice}</p>
            </div>
          </div>
        )}

        {/* Empty State */}
        {metrics.length === 0 && !burnRate && !analysis && (
          <div className="rounded-2xl border border-dashed border-border py-16 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
              <ChartIcon className="h-7 w-7 text-primary" />
            </div>
            <h3 className="mb-2 font-semibold text-foreground">Your command center is empty</h3>
            <p className="mb-6 text-sm text-foreground-secondary">
              Add metrics and burn rate data to track your startup health.
            </p>
            <button
              onClick={() => setShowMetricForm(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
            >
              <PlusIcon className="h-4 w-4" />
              Add Your First Metric
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
