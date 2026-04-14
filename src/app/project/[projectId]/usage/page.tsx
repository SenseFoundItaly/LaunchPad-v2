'use client';

import { use, useEffect, useState, useCallback } from 'react';
import api from '@/api';
import { BarChart } from '@/components/charts';
import type { ApiResponse } from '@/types';

interface UsageLog {
  id: string;
  skill_id: string | null;
  step: string | null;
  provider: string;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  total_cost_usd: number;
  latency_ms: number;
  created_at: string;
}

interface SkillCost {
  skill_id: string;
  total_cost: number;
  call_count: number;
}

interface UsageSummary {
  total_cost_usd: number;
  total_tokens: number;
  total_input_tokens: number;
  total_output_tokens: number;
  call_count: number;
}

interface UsageData {
  summary: UsageSummary;
  by_skill: SkillCost[];
  logs: UsageLog[];
}

export default function UsagePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUsage = useCallback(async () => {
    try {
      const { data: resp } = await api.get<ApiResponse<UsageData>>(
        `/api/projects/${projectId}/usage`,
      );
      if (resp.data) setData(resp.data);
    } catch {
      // usage table might not exist yet
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchUsage();
  }, [fetchUsage]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
        Loading usage data...
      </div>
    );
  }

  const summary = data?.summary;
  const logs = data?.logs || [];
  const bySkill = data?.by_skill || [];

  const chartData = bySkill
    .filter((s) => s.total_cost > 0)
    .map((s) => ({
      name: s.skill_id,
      value: parseFloat(s.total_cost.toFixed(4)),
    }));

  function formatCost(usd: number): string {
    if (usd < 0.01) return `$${usd.toFixed(4)}`;
    return `$${usd.toFixed(2)}`;
  }

  function formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  }

  function formatLatency(ms: number): string {
    if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
    return `${ms}ms`;
  }

  function formatTime(iso: string): string {
    try {
      const d = new Date(iso);
      return d.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto">
        <h3 className="text-lg font-semibold text-white mb-6">LLM Usage</h3>

        {/* Summary cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <div className="text-xs text-zinc-400 uppercase tracking-wider mb-1">
              Total Cost
            </div>
            <div className="text-2xl font-bold text-white">
              {formatCost(summary?.total_cost_usd ?? 0)}
            </div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <div className="text-xs text-zinc-400 uppercase tracking-wider mb-1">
              Total Tokens
            </div>
            <div className="text-2xl font-bold text-white">
              {formatTokens(summary?.total_tokens ?? 0)}
            </div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <div className="text-xs text-zinc-400 uppercase tracking-wider mb-1">
              Input Tokens
            </div>
            <div className="text-2xl font-bold text-white">
              {formatTokens(summary?.total_input_tokens ?? 0)}
            </div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <div className="text-xs text-zinc-400 uppercase tracking-wider mb-1">
              API Calls
            </div>
            <div className="text-2xl font-bold text-white">
              {summary?.call_count ?? 0}
            </div>
          </div>
        </div>

        {/* Cost by skill chart */}
        {chartData.length > 0 && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-8">
            <h4 className="text-sm font-medium text-white mb-4">Cost by Skill</h4>
            <BarChart data={chartData} title="" height={Math.max(200, chartData.length * 40)} />
          </div>
        )}

        {/* Recent calls table */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-800">
            <h4 className="text-sm font-medium text-white">Recent Calls</h4>
          </div>
          {logs.length === 0 ? (
            <div className="px-6 py-12 text-center text-zinc-500 text-sm">
              No LLM usage recorded yet. Usage will appear here as you interact with skills and the workspace.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-400 text-xs uppercase tracking-wider">
                    <th className="px-4 py-3 text-left">Time</th>
                    <th className="px-4 py-3 text-left">Skill / Step</th>
                    <th className="px-4 py-3 text-left">Provider</th>
                    <th className="px-4 py-3 text-left">Model</th>
                    <th className="px-4 py-3 text-right">Tokens</th>
                    <th className="px-4 py-3 text-right">Cost</th>
                    <th className="px-4 py-3 text-right">Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                      <td className="px-4 py-3 text-zinc-400 whitespace-nowrap">
                        {formatTime(log.created_at)}
                      </td>
                      <td className="px-4 py-3 text-zinc-300">
                        {log.skill_id || log.step || '--'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          log.provider === 'anthropic'
                            ? 'bg-orange-500/20 text-orange-400'
                            : log.provider === 'openai'
                              ? 'bg-green-500/20 text-green-400'
                              : 'bg-blue-500/20 text-blue-400'
                        }`}>
                          {log.provider}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-zinc-400 text-xs">
                        {log.model || '--'}
                      </td>
                      <td className="px-4 py-3 text-right text-zinc-300 tabular-nums">
                        {formatTokens(log.input_tokens + log.output_tokens)}
                      </td>
                      <td className="px-4 py-3 text-right text-zinc-300 tabular-nums">
                        {formatCost(log.total_cost_usd)}
                      </td>
                      <td className="px-4 py-3 text-right text-zinc-400 tabular-nums">
                        {formatLatency(log.latency_ms)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
