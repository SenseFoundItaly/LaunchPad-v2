'use client';

/**
 * Source freshness — one StatusBar row per funding source (SEDIA, Lombardia)
 * saying when the source was last read successfully, plus an unmissable banner
 * when any source is dead (so the deadlines below are read with suspicion).
 *
 * A `truncated:` last_error is a WARNING from a successful partial run, never
 * a dead source — classifyFreshness caps it at `stale`.
 */

import { Panel, StatusBar } from '@/components/design/primitives';
import { useT } from '@/components/providers/LocaleProvider';
import type { MessageKey } from '@/lib/i18n/messages';
import { classifyFreshness, relativeAge, type SourceFreshness } from '@/lib/grants/view';

const SOURCE_NAME: Record<'sedia' | 'lombardia' | 'incentivi', MessageKey> = {
  sedia: 'grants.source.sedia',
  lombardia: 'grants.source.lombardia',
  incentivi: 'grants.source.incentivi',
};

const STATE_KEY: Record<'healthy' | 'stale' | 'dead', MessageKey> = {
  healthy: 'grants.freshness.state-healthy',
  stale: 'grants.freshness.state-stale',
  dead: 'grants.freshness.state-dead',
};

export function GrantsFreshness({ sources, now }: { sources: SourceFreshness[]; now: Date }) {
  const t = useT();

  function ago(iso: string | null): string | null {
    const age = relativeAge(iso, now);
    if (!age) return null;
    switch (age.unit) {
      case 'now':
        return t('monitors.just-now');
      case 'minutes':
        return t('monitors.age-minutes', { n: age.n });
      case 'hours':
        return t('monitors.age-hours', { n: age.n });
      case 'days':
        return t('monitors.age-days', { n: age.n });
      case 'weeks':
        return t('monitors.age-weeks', { n: age.n });
    }
  }

  const rows = sources.map((s) => {
    const kind = classifyFreshness(s.last_success_at, s.last_error, now);
    const when = ago(s.last_success_at);
    const name = t(SOURCE_NAME[s.source]);
    const failed = !!s.last_error && !s.last_error.startsWith('truncated:');
    // "Last scan" = the last ATTEMPT (updated_at); "verified" = last SUCCESS.
    const scanWhen = ago(s.updated_at) ?? when;
    let ctx: string;
    if (failed) {
      ctx = t('grants.freshness.scan-failed', { when: scanWhen ?? '—', error: s.last_error!.slice(0, 80) })
        + (when ? ` · ${t('grants.freshness.verified', { when })}` : '');
    } else if (s.last_error) {
      ctx = t('grants.freshness.scan-partial', { when: scanWhen ?? '—' });
    } else if (!when) {
      ctx = t('grants.freshness.never');
    } else {
      ctx = t('grants.freshness.scan-ok', { when: scanWhen ?? when });
    }
    return {
      source: s.source,
      kind,
      name,
      failed,
      when,
      heartbeatLabel: `${name} · ${t(STATE_KEY[kind])}`,
      ctx,
      // No count before the first successful sync — '0 calls' would read as a result.
      hints: [
        ...(s.last_count === null ? [] : [t('grants.freshness.count', { n: s.last_count })]),
        ...(s.pages_failed ? [t('grants.freshness.pages-failed', { n: s.pages_failed })] : []),
        ...(s.pages_unread ? [t('grants.freshness.pages-unread', { n: s.pages_unread })] : []),
      ],
    };
  });

  // Three dead shapes, two banners: a recorded failure ("did not complete"),
  // a source that simply has not been read for 72h+ ("last read 4d ago"),
  // and never-synced (fresh deploy, cron not yet ticked) — which is expected,
  // not a failure, so it gets no banner; the row already says "Never synced".
  const failedNames = rows.filter((r) => r.kind === 'dead' && r.failed).map((r) => r.name);
  const ageDead = rows.filter((r) => r.kind === 'dead' && !r.failed && r.when);
  const banners: string[] = [];
  if (failedNames.length > 0) banners.push(t('grants.freshness.dead-banner', { source: failedNames.join(', ') }));
  for (const r of ageDead) banners.push(t('grants.freshness.dead-banner-age', { source: r.name, when: r.when! }));

  return (
    <>
      {banners.map((text) => (
        <div
          key={text}
          role="alert"
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            padding: '10px 14px',
            border: '1px solid var(--clay)',
            background: 'var(--clay-wash)',
            borderRadius: 'var(--r-m)',
            color: 'var(--ink)',
            fontSize: 12.5,
            fontWeight: 600,
          }}
        >
          {text}
        </div>
      ))}
      <Panel
        title={t('grants.freshness.title')}
        subtitle={t('grants.freshness.subtitle')}
        style={{ overflow: 'hidden' }}
      >
        {rows.map((r) => (
          <StatusBar
            key={r.source}
            heartbeatKind={r.kind}
            heartbeatLabel={r.heartbeatLabel}
            ctxLabel={r.ctx}
            hints={r.hints}
          />
        ))}
      </Panel>
    </>
  );
}
