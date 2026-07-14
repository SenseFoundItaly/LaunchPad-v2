'use client';

/**
 * Launch-pipeline artifact cards (W2/W3).
 *
 * EmailSequenceCard / SocialCalendarCard — read surfaces over the captured
 * DRAFT campaign: the chat card shows the copy; activation (recipients,
 * schedule) happens in the Launch panel, sends happen via Inbox approvals.
 * AdPackCard — export-first deliverable with the two editor downloads.
 *
 * Email bodies are LLM-generated HTML — previewed here as STRIPPED TEXT
 * (never dangerouslySetInnerHTML: an injected <script>/<img onerror> in a
 * generated body must not execute in the founder's session). The real HTML
 * is what the sender ships; the card is a copy review surface.
 */

import { useState } from 'react';
import type { EmailSequenceArtifact, SocialCalendarArtifact, AdPackArtifact } from '@/types/artifacts';
import { Pill, IconBtn, I } from '@/components/design/primitives';
import { toGoogleAdsCsv, toMetaBulkJson } from '@/lib/launch/ad-export';
import ArtifactCardShell from './ArtifactCardShell';

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** HTML → readable plain text for safe preview (tags dropped, blocks kept). */
function htmlToPreviewText(html: string): string {
  return (html || '')
    .replace(/<\s*(br|\/p|\/div|\/li)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const rowStyle: React.CSSProperties = {
  display: 'flex', gap: 10, alignItems: 'baseline',
  padding: '8px 0', borderBottom: '1px solid var(--line)',
};

export function EmailSequenceCard({ artifact, defaultCollapsed }: { artifact: EmailSequenceArtifact; defaultCollapsed?: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <ArtifactCardShell
      typeLabel="Campaign"
      title={artifact.title}
      sources={artifact.sources}
      defaultCollapsed={defaultCollapsed}
      headerRight={<Pill kind="ok" dot>{artifact.goal}</Pill>}
    >
      <p className="lp-mono" style={{ margin: '0 0 8px', fontSize: 10, color: 'var(--ink-5)' }}>
        Saved as a draft campaign — activate it (with your recipient list) from the Launch panel; each send is approved in your Inbox.
      </p>
      {(artifact.messages ?? []).map((m, i) => (
        <div key={i} style={{ borderBottom: '1px solid var(--line)' }}>
          <button
            onClick={() => setOpen(open === i ? null : i)}
            style={{ ...rowStyle, width: '100%', textAlign: 'left', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)', whiteSpace: 'nowrap' }}>
              #{m.position} · day {m.send_offset_days}
            </span>
            <span style={{ fontSize: 12.5, color: 'var(--ink-1)', flex: 1, minWidth: 0 }}>{m.subject}</span>
          </button>
          {open === i && (
            <div style={{ padding: '0 0 10px', fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
              {htmlToPreviewText(m.body_html)}
            </div>
          )}
        </div>
      ))}
      {artifact.audience_notes && (
        <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--ink-4)' }}>{artifact.audience_notes}</p>
      )}
    </ArtifactCardShell>
  );
}

export function SocialCalendarCard({ artifact, defaultCollapsed }: { artifact: SocialCalendarArtifact; defaultCollapsed?: boolean }) {
  return (
    <ArtifactCardShell
      typeLabel="Campaign"
      title={artifact.title}
      sources={artifact.sources}
      defaultCollapsed={defaultCollapsed}
      headerRight={<Pill kind="ok" dot>{(artifact.posts ?? []).length} posts</Pill>}
    >
      <p className="lp-mono" style={{ margin: '0 0 8px', fontSize: 10, color: 'var(--ink-5)' }}>
        Saved as a draft calendar — activate it from the Launch panel; each post is proposed in your Inbox on its day.
      </p>
      {(artifact.posts ?? []).map((p, i) => (
        <div key={i} style={rowStyle}>
          <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)', whiteSpace: 'nowrap' }}>
            day {p.day_offset} · {p.channel === 'x' ? 'X' : 'LinkedIn'}
          </span>
          <span style={{ fontSize: 12, color: 'var(--ink-2)', flex: 1, whiteSpace: 'pre-wrap' }}>{p.body}</span>
        </div>
      ))}
    </ArtifactCardShell>
  );
}

export function AdPackCard({ artifact, defaultCollapsed }: { artifact: AdPackArtifact; defaultCollapsed?: boolean }) {
  const slug = (artifact.title || 'ad-pack').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
  return (
    <ArtifactCardShell
      typeLabel="Ad Pack"
      title={artifact.title}
      sources={artifact.sources}
      defaultCollapsed={defaultCollapsed}
      headerRight={<>
        <Pill kind="ok" dot>${artifact.budget?.total_monthly_usd ?? 0}/mo</Pill>
        <IconBtn
          d={I.download}
          title="Google Ads Editor CSV"
          onClick={() => download(`${slug}-google-ads.csv`, toGoogleAdsCsv(artifact), 'text/csv')}
        />
        <IconBtn
          d={I.file}
          title="Meta bulk JSON"
          onClick={() => download(`${slug}-meta-bulk.json`, toMetaBulkJson(artifact), 'application/json')}
        />
      </>}
    >
      {(artifact.audiences ?? []).map((a, i) => (
        <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
            <strong style={{ fontSize: 12.5, color: 'var(--ink-1)' }}>{a.name}</strong>
            <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>
              {artifact.budget?.split?.find((s) => s.audience === a.name)?.pct ?? 0}% budget
            </span>
          </div>
          <p style={{ margin: '4px 0 0', fontSize: 11.5, color: 'var(--ink-3)' }}>{a.targeting_notes}</p>
          {(artifact.ads ?? []).filter((ad) => ad.audience === a.name).map((ad, j) => (
            <div key={j} style={{ margin: '6px 0 0', paddingLeft: 10, borderLeft: '2px solid var(--line-2)' }}>
              <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>{(ad.headlines ?? []).join(' · ')}</div>
              {ad.primary_text && <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 2 }}>{ad.primary_text}</div>}
            </div>
          ))}
        </div>
      ))}
      <p className="lp-mono" style={{ margin: '8px 0 0', fontSize: 10, color: 'var(--ink-5)' }}>
        Export-first: download and import into the ad editors — LaunchPad never touches your ad accounts.
      </p>
    </ArtifactCardShell>
  );
}
