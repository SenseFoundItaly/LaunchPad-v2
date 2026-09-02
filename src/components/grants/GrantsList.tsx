'use client';

/**
 * Grants list — one card per funding call: title (link to the official page),
 * granting body / status / source / alerted pills, deadline + countdown +
 * verification date, and an eligibility excerpt that expands (button, so it
 * works from the keyboard) to the full source text.
 */

import { useState } from 'react';
import Link from 'next/link';
import { Icon, I, Pill } from '@/components/design/primitives';
import { useLocale, useT } from '@/components/providers/LocaleProvider';
import {
  countdownParts,
  deadlineBucket,
  excerptEligibility,
  statusPillKind,
  type FundingCallView,
} from '@/lib/grants/view';

export function GrantsList({
  projectId,
  calls,
  now,
}: {
  projectId: string;
  calls: FundingCallView[];
  now: Date;
}) {
  const t = useT();
  return (
    <ul
      aria-label={t('grants.list.aria')}
      style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      {calls.map((call) => (
        <GrantRow key={call.id} projectId={projectId} call={call} now={now} />
      ))}
    </ul>
  );
}

const DATE_OPTS: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };

function GrantRow({ projectId, call, now }: { projectId: string; call: FundingCallView; now: Date }) {
  const t = useT();
  const locale = useLocale();
  const tag = locale === 'it' ? 'it-IT' : 'en-GB';
  const [open, setOpen] = useState(false);

  const bucket = deadlineBucket(call, now);
  const kind = statusPillKind(call, now);
  const days = countdownParts(call.deadline, now)?.days ?? null;
  const { short, truncated } = excerptEligibility(call.eligibility_text);
  const regionId = `grants-elig-${call.id}`;

  const fmtDate = (iso: string) =>
    new Intl.DateTimeFormat(tag, { ...DATE_OPTS, timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
  const fmtDateTime = (iso: string) => new Intl.DateTimeFormat(tag, DATE_OPTS).format(new Date(iso));

  const statusLabel =
    bucket === 'rolling'
      ? t('grants.status.rolling')
      : call.status === 'closed' || (days !== null && days < 0)
        ? t('grants.status.closed')
        : kind === 'warn'
          ? t('grants.status.closing')
          : t('grants.status.open');

  let deadlineText: string | null = null;
  let countdown: string | null = null;
  if (bucket !== 'rolling' && call.deadline) {
    const dateStr = fmtDate(call.deadline);
    deadlineText = call.deadline_time
      ? t('grants.row.deadline-with-time', { date: dateStr, time: call.deadline_time })
      : dateStr;
    if (days !== null) {
      countdown =
        days === 0
          ? t('grants.countdown.today')
          : days === 1
            ? t('grants.countdown.tomorrow')
            : days > 1
              ? t('grants.countdown.in-days', { n: days })
              : t('grants.countdown.past');
    }
  }

  return (
    <li className="lp-card" style={{ padding: '12px 14px' }}>
      <a
        href={call.official_url}
        target="_blank"
        rel="noopener noreferrer"
        title={t('grants.row.open-official')}
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: 'var(--ink)',
          textDecoration: 'none',
          display: 'inline-flex',
          gap: 6,
          alignItems: 'center',
        }}
      >
        {call.title}
        <Icon d={I.external} size={12} style={{ opacity: 0.6 }} />
      </a>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6, alignItems: 'center' }}>
        {call.granting_body && <Pill kind="n">{call.granting_body}</Pill>}
        <Pill kind={kind} dot>
          {statusLabel}
        </Pill>
        <Pill kind="info">
          {t(call.source === 'sedia' ? 'grants.source.sedia-short' : 'grants.source.lombardia-short')}
        </Pill>
        {call.alerted && (
          <Link href={`/project/${projectId}/actions`} style={{ textDecoration: 'none' }}>
            <Pill kind="ok" dot>
              {t('grants.row.alerted')}
            </Pill>
          </Link>
        )}
      </div>

      <div
        className="lp-mono"
        style={{
          fontSize: 11,
          color: 'var(--ink-4)',
          marginTop: 6,
          display: 'flex',
          gap: 12,
          flexWrap: 'wrap',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        <span>
          {t('grants.row.deadline')}
          {': '}
          {deadlineText ?? t('grants.row.no-deadline')}
          {countdown && (
            <span style={{ marginLeft: 6, color: kind === 'warn' ? 'var(--clay-ink)' : 'var(--ink-3)' }}>
              {countdown}
            </span>
          )}
        </span>
        <span>{t('grants.row.verified', { date: fmtDateTime(call.last_verified_at) })}</span>
      </div>

      {!call.eligibility_text ? (
        <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--ink-5)', fontStyle: 'italic' }}>
          {call.page_status === 'unread'
            ? t('grants.row.page-unread')
            : call.page_status === 'failed'
              ? t('grants.row.page-failed', { error: call.page_error ?? '—', date: fmtDateTime(call.page_checked_at ?? call.last_verified_at) })
              : t('grants.row.no-eligibility')}
        </p>
      ) : (
        <div style={{ marginTop: 8 }}>
          <div
            className="lp-mono"
            style={{ fontSize: 10.5, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--ink-5)' }}
          >
            {t('grants.row.eligibility')}
          </div>
          <p
            id={regionId}
            style={{
              margin: '4px 0 0',
              fontSize: 12.5,
              color: 'var(--ink-2)',
              lineHeight: 1.5,
              whiteSpace: open ? 'pre-wrap' : 'normal',
            }}
          >
            {open ? call.eligibility_text : short}
          </p>
          {truncated && (
            <button
              type="button"
              aria-expanded={open}
              aria-controls={regionId}
              onClick={() => setOpen((o) => !o)}
              style={{
                marginTop: 4,
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--accent-ink)',
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                display: 'inline-flex',
                gap: 4,
                alignItems: 'center',
              }}
            >
              {t(open ? 'grants.row.collapse' : 'grants.row.expand')}
              <Icon d={open ? I.chevu : I.chevd} size={11} />
            </button>
          )}
        </div>
      )}
    </li>
  );
}
