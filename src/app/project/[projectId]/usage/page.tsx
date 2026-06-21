'use client';

import { use, useEffect, useState, useCallback } from 'react';
import api from '@/api';
import { BarChart } from '@/components/charts';
import { useSetChrome } from '@/components/design/chrome-context';
import { useT } from '@/components/providers/LocaleProvider';
import { USER_MONTHLY_CREDITS, USER_MONTHLY_LLM_USD } from '@/lib/credit-costs';
import type { ApiResponse } from '@/types';

// Canonical credits-per-USD ratio (3× markup) used as the fallback when a
// project has no budget row yet — derived from the pool so it matches the
// server's own conversion (see src/lib/credit-costs.ts).
const DEFAULT_CREDITS_PER_USD = USER_MONTHLY_CREDITS / USER_MONTHLY_LLM_USD;

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

// Subset of the /credits snapshot this page needs: the monthly position
// (remaining/total) and the plan ratio inputs (total credits / USD cap).
interface CreditsInfo {
  remaining: number;
  total: number;
  used_usd: number;
  cap_usd: number;
}

export default function UsagePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const t = useT();
  const [data, setData] = useState<UsageData | null>(null);
  const [credits, setCredits] = useState<CreditsInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useSetChrome(
    {
      breadcrumb: [t('usage.breadcrumb-project'), t('usage.breadcrumb-usage')],
      status: { heartbeatLabel: 'usage', gateway: 'pi-agent · anthropic' },
    },
    [t],
  );

  const fetchUsage = useCallback(async () => {
    try {
      const { data: resp } = await api.get<ApiResponse<UsageData>>(
        `/api/projects/${projectId}/usage`,
      );
      if (resp.data) setData(resp.data);
    } catch {
      // usage table might not exist yet
    }
    try {
      const { data: resp } = await api.get<ApiResponse<CreditsInfo>>(
        `/api/projects/${projectId}/credits`,
      );
      if (resp.data) setCredits(resp.data);
    } catch {
      // budget row might not exist yet — fall back to the default ratio
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    fetchUsage();
  }, [fetchUsage]);

  if (loading) {
    return (
      <div className="flex items-center justify-center flex-1 text-ink-5 text-sm">
        {t('usage.loading')}
      </div>
    );
  }

  const summary = data?.summary;
  const logs = data?.logs || [];
  const bySkill = data?.by_skill || [];

  // Credits are the founder-facing money unit (same number the TopBar badge
  // counts). USD stays visible as small secondary text for admins. The
  // conversion uses the project's own plan ratio (monthly credits ÷ USD cap);
  // falls back to the canonical ~300 credits/$ when no budget row exists yet.
  const creditsPerUsd =
    credits && credits.cap_usd > 0 && credits.total > 0
      ? credits.total / credits.cap_usd
      : DEFAULT_CREDITS_PER_USD;

  function toCredits(usd: number): number {
    return usd * creditsPerUsd;
  }

  function formatCredits(c: number): string {
    if (c > 0 && c < 0.1) return '<0.1';
    if (c < 10) return c.toFixed(1);
    return String(Math.round(c));
  }

  const chartData = bySkill
    .filter((s) => s.total_cost > 0)
    .map((s) => ({
      name: s.skill_id,
      value: parseFloat(toCredits(s.total_cost).toFixed(1)),
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
    <div className="lp-rise flex-1 overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto">
            <h3 className="text-lg font-semibold text-ink mb-6">{t('usage.title')}</h3>

        {/* Summary cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-paper border border-line rounded-xl p-4">
            <div className="text-xs text-ink-4 uppercase tracking-wider mb-1">
              {t('usage.credits-used')}
            </div>
            <div className="text-2xl font-bold text-ink">
              {formatCredits(toCredits(summary?.total_cost_usd ?? 0))}
              <span className="text-sm font-medium text-ink-4"> {t('usage.credits-unit')}</span>
            </div>
            <div className="text-xs text-ink-5 mt-1">
              {formatCost(summary?.total_cost_usd ?? 0)} {t('usage.usd')}
              {credits
                ? ` · ${t('usage.left-this-month', { remaining: credits.remaining, total: credits.total })}`
                : ''}
            </div>
          </div>
          <div className="bg-paper border border-line rounded-xl p-4">
            <div className="text-xs text-ink-4 uppercase tracking-wider mb-1">
              {t('usage.total-tokens')}
            </div>
            <div className="text-2xl font-bold text-ink">
              {formatTokens(summary?.total_tokens ?? 0)}
            </div>
          </div>
          <div className="bg-paper border border-line rounded-xl p-4">
            <div className="text-xs text-ink-4 uppercase tracking-wider mb-1">
              {t('usage.input-tokens')}
            </div>
            <div className="text-2xl font-bold text-ink">
              {formatTokens(summary?.total_input_tokens ?? 0)}
            </div>
          </div>
          <div className="bg-paper border border-line rounded-xl p-4">
            <div className="text-xs text-ink-4 uppercase tracking-wider mb-1">
              {t('usage.api-calls')}
            </div>
            <div className="text-2xl font-bold text-ink">
              {summary?.call_count ?? 0}
            </div>
          </div>
        </div>

        {/* Credits by skill chart (values converted from USD at the plan ratio) */}
        {chartData.length > 0 && (
          <div className="bg-paper border border-line rounded-xl p-6 mb-8">
            <h4 className="text-sm font-medium text-ink mb-4">{t('usage.credits-by-skill')}</h4>
            <BarChart data={chartData} title="" height={Math.max(200, chartData.length * 40)} />
          </div>
        )}

        {/* Recent calls table */}
        <div className="bg-paper border border-line rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-line">
            <h4 className="text-sm font-medium text-ink">{t('usage.recent-calls')}</h4>
          </div>
          {logs.length === 0 ? (
            <div className="px-6 py-12 text-center text-ink-5 text-sm">
              {t('usage.empty-state')}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-ink-4 text-xs uppercase tracking-wider">
                    <th className="px-4 py-3 text-left">{t('usage.col-time')}</th>
                    <th className="px-4 py-3 text-left">{t('usage.col-skill-step')}</th>
                    <th className="px-4 py-3 text-left">{t('usage.col-provider')}</th>
                    <th className="px-4 py-3 text-left">{t('usage.col-model')}</th>
                    <th className="px-4 py-3 text-right">{t('usage.col-tokens')}</th>
                    <th className="px-4 py-3 text-right">{t('usage.col-credits')}</th>
                    <th className="px-4 py-3 text-right">{t('usage.col-latency')}</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id} className="border-b border-line/50 hover:bg-paper-2/30 transition-colors">
                      <td className="px-4 py-3 text-ink-4 whitespace-nowrap">
                        {formatTime(log.created_at)}
                      </td>
                      <td className="px-4 py-3 text-ink-3">
                        {log.skill_id || log.step || '--'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          log.provider === 'anthropic'
                            ? 'bg-accent/20 text-accent'
                            : log.provider === 'openai'
                              ? 'bg-moss/20 text-moss'
                              : 'bg-moss/20 text-moss'
                        }`}>
                          {log.provider}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-ink-4 text-xs">
                        {log.model || '--'}
                      </td>
                      <td className="px-4 py-3 text-right text-ink-3 tabular-nums">
                        {formatTokens(log.input_tokens + log.output_tokens)}
                      </td>
                      <td className="px-4 py-3 text-right text-ink-3 tabular-nums whitespace-nowrap">
                        {formatCredits(toCredits(log.total_cost_usd))}
                        <span className="text-xs text-ink-5 ml-1">{formatCost(log.total_cost_usd)}</span>
                      </td>
                      <td className="px-4 py-3 text-right text-ink-4 tabular-nums">
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
