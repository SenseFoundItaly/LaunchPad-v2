'use client';

/**
 * Grants — open EU (Funding & Tenders) + Regione Lombardia funding calls with
 * code-parsed deadlines. Fetches the project's grants view once (no params —
 * the server defaults to open+rolling) and filters/searches client-side with
 * the pure helpers in src/lib/grants/view.ts.
 */

import { use, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '@/components/providers/LocaleProvider';
import { useSetChrome } from '@/components/design/chrome-context';
import { Pill } from '@/components/design/primitives';
import { LoadingState } from '@/components/ui/LoadingState';
import type { MessageKey } from '@/lib/i18n/messages';
import {
  GRANTS_CHIPS,
  applyFilters,
  chipCounts,
  matchesQuery,
  type GrantsChip,
  type GrantsResponse,
  matchesRegion,
  ITALIAN_REGIONS,
  NATIONAL_REGION
} from '@/lib/grants/view';
import { GrantsFreshness } from '@/components/grants/GrantsFreshness';
import { GrantsAlertsToggle } from '@/components/grants/GrantsAlertsToggle';
import { GrantsList } from '@/components/grants/GrantsList';

// Template keys (`grants.chip.${c}`) would defeat MessageKey checking — map explicitly.
const CHIP_LABEL: Record<GrantsChip, MessageKey> = {
  all: 'grants.chip.all',
  'closing-soon': 'grants.chip.closing-soon',
  rolling: 'grants.chip.rolling',
  sedia: 'grants.chip.sedia',
  lombardia: 'grants.chip.lombardia',
  incentivi: 'grants.chip.incentivi',
};

export default function GrantsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const t = useT();

  const { data, isLoading, error, refetch } = useQuery<GrantsResponse>({
    queryKey: ['grants', projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/grants`);
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.success === false) {
        // `response.status` is what QueryProvider's retryUnlessClientError reads
        // to skip retries on 4xx (401/403/404 are deterministic).
        const err = new Error(body?.error || `HTTP ${res.status}`) as Error & { response?: { status: number } };
        err.response = { status: res.status };
        throw err;
      }
      return body.data as GrantsResponse;
    },
  });

  // "Now" is pinned per response so countdowns/freshness don't drift between renders.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => new Date(), [data]);

  const [chip, setChip] = useState<GrantsChip>('all');
  const [q, setQ] = useState('');
  const [region, setRegion] = useState<string>('');

  const calls = useMemo(() => data?.calls ?? [], [data]);
  const searched = useMemo(() => calls.filter((c) => matchesQuery(c, q) && matchesRegion(c, region || null)), [calls, q, region]);
  const counts = useMemo(() => chipCounts(searched, now), [searched, now]);
  const visible = useMemo(() => applyFilters(calls, { chip, q, region: region || null }, now), [calls, chip, q, region, now]);

  useSetChrome(
    {
      breadcrumb: [t('grants.breadcrumb-project'), t('grants.breadcrumb-grants')],
      right: data ? <Pill kind="n">{t('grants.count-open', { n: data.calls.length })}</Pill> : undefined,
    },
    [t, data?.calls.length],
  );

  return (
    <div className="lp-scroll" style={{ flex: 1, minWidth: 0, overflow: 'auto', background: 'var(--paper)' }}>
      <div
        style={{
          maxWidth: 960,
          margin: '0 auto',
          padding: '20px 20px 40px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div>
          <h1
            style={{
              fontFamily: 'var(--f-display)',
              fontSize: 20,
              fontWeight: 600,
              letterSpacing: -0.3,
              margin: 0,
              color: 'var(--ink)',
            }}
          >
            {t('grants.title')}
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--ink-4)', lineHeight: 1.5 }}>
            {t('grants.scope')}
          </p>
        </div>

        {isLoading && <LoadingState label={t('grants.loading')} />}

        {!isLoading && error && (
          <div
            role="alert"
            style={{
              padding: 14,
              border: '1px solid var(--clay)',
              background: 'var(--clay-wash)',
              borderRadius: 'var(--r-m)',
              color: 'var(--ink)',
              fontSize: 12.5,
            }}
          >
            {t('grants.load-error')}
            <button
              type="button"
              onClick={() => refetch()}
              style={{
                marginLeft: 8,
                fontSize: 12,
                fontWeight: 600,
                background: 'var(--ink)',
                color: 'var(--paper)',
                border: 'none',
                borderRadius: 'var(--r-m)',
                padding: '5px 10px',
                cursor: 'pointer',
              }}
            >
              {t('common.retry')}
            </button>
          </div>
        )}

        {data && (
          <>
            <GrantsFreshness sources={data.sources} now={now} />
            <GrantsAlertsToggle projectId={projectId} monitor={data.grants_monitor} />

            {data.calls.length === 0 ? (
              <div
                style={{
                  padding: '28px 16px',
                  textAlign: 'center',
                  border: '1px dashed var(--line-2)',
                  borderRadius: 'var(--r-m)',
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{t('grants.empty.title')}</div>
                <p style={{ fontSize: 12.5, color: 'var(--ink-4)', maxWidth: 420, margin: '6px auto 0', lineHeight: 1.5 }}>
                  {t('grants.empty.body')}
                </p>
              </div>
            ) : (
              <>
                <div>
                  <div
                    role="group"
                    aria-label={t('grants.filters-aria')}
                    style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}
                  >
                    {GRANTS_CHIPS.map((c) => {
                      const active = chip === c;
                      const hint =
                        c === 'closing-soon'
                          ? t('grants.chip.closing-soon-hint')
                          : c === 'rolling'
                            ? t('grants.chip.rolling-hint')
                            : undefined;
                      return (
                        <button
                          key={c}
                          type="button"
                          aria-pressed={active}
                          onClick={() => setChip(c)}
                          title={hint}
                          style={{
                            display: 'inline-flex',
                            gap: 6,
                            alignItems: 'center',
                            borderRadius: 999,
                            padding: '4px 10px',
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: 'pointer',
                            background: active ? 'var(--ink)' : 'var(--surface)',
                            color: active ? 'var(--paper)' : 'var(--ink-3)',
                            border: active ? '1px solid var(--ink)' : '1px solid var(--line)',
                          }}
                        >
                          {t(CHIP_LABEL[c])}
                          <span
                            style={{
                              fontFamily: 'var(--f-mono)',
                              fontVariantNumeric: 'tabular-nums',
                              fontSize: 10.5,
                              opacity: 0.75,
                            }}
                          >
                            {counts[c]}
                          </span>
                        </button>
                      );
                    })}
                    <select
                      aria-label={t('grants.region-aria')}
                      value={region}
                      onChange={(e) => setRegion(e.target.value)}
                      style={{
                        borderRadius: 999,
                        padding: '4px 10px',
                        fontSize: 12,
                        fontWeight: 600,
                        background: region ? 'var(--ink)' : 'var(--surface)',
                        color: region ? 'var(--paper)' : 'var(--ink-3)',
                        border: region ? '1px solid var(--ink)' : '1px solid var(--line)',
                      }}
                    >
                      <option value="">{t('grants.region.all')}</option>
                      <option value={NATIONAL_REGION}>{t('grants.region.national')}</option>
                      {ITALIAN_REGIONS.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                    <input
                      type="search"
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      placeholder={t('grants.search.placeholder')}
                      aria-label={t('grants.search.aria')}
                      style={{
                        marginLeft: 'auto',
                        fontSize: 12.5,
                        padding: '6px 10px',
                        border: '1px solid var(--line-2)',
                        borderRadius: 'var(--r-m)',
                        background: 'var(--surface)',
                        color: 'var(--ink)',
                        minWidth: 220,
                      }}
                    />
                  </div>
                  <div
                    className="lp-mono"
                    style={{ marginTop: 6, fontSize: 10.5, color: 'var(--ink-5)', fontVariantNumeric: 'tabular-nums' }}
                  >
                    {t('grants.results-count', { n: visible.length, total: data.calls.length })}
                  </div>
                </div>

                {visible.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: 'var(--ink-4)', padding: 16 }}>
                    {t('grants.no-match')}
                    <button
                      type="button"
                      onClick={() => {
                        setChip('all');
                        setQ('');
                      }}
                      style={{
                        marginLeft: 6,
                        fontSize: 12,
                        textDecoration: 'underline',
                        background: 'none',
                        border: 'none',
                        color: 'var(--accent-ink)',
                        cursor: 'pointer',
                      }}
                    >
                      {t('grants.clear-filters')}
                    </button>
                  </div>
                ) : (
                  <GrantsList projectId={projectId} calls={visible} now={now} />
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
