'use client';

/**
 * PayloadSummary — tidy key→value rendering of a pending_action payload.
 *
 * Default review body for action types without a dedicated pane
 * (configure_monitor and run_skill have their own). Replaces the bare
 * <pre>JSON.stringify</pre> dump: prettified keys, noisy internals hidden,
 * full JSON one click away behind "view raw".
 */

import { FieldLabel, RawPayloadToggle } from './fields';

// Internals the founder never needs to read — they stay in "view raw".
const NOISY_KEY = /^(id|owner_user_id|user_id|project_id|pending_action_id|artifact_id|session_id)$|_ids?$/;

// Keys whose string values are machine slugs ('competitor_activity') — their
// values get prettified to "Competitor activity". Scoped to known enum-ish
// keys so free text that happens to contain underscores is never mangled.
const ENUM_VALUE_KEY = /^(alert_type|kind|category|schedule|cadence|priority|severity|status)$/;
const SLUG_VALUE = /^[a-z][a-z0-9_-]*$/;

const MAX_STRING = 600;

function prettifyKey(key: string): string {
  const s = key.replace(/_/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function prettifySlug(value: string): string {
  const s = value.replace(/[_-]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function isHttpUrl(s: string): boolean {
  return /^https?:\/\/\S+$/i.test(s);
}

function displayValue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    const t = v.trim();
    if (!t) return null;
    return t.length > MAX_STRING ? `${t.slice(0, MAX_STRING)}…` : t;
  }
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return null;
    if (v.every((x) => typeof x === 'string' || typeof x === 'number')) {
      return v.join(', ');
    }
    return `${v.length} item${v.length === 1 ? '' : 's'} — see raw`;
  }
  if (typeof v === 'object') {
    const json = JSON.stringify(v);
    return json.length > MAX_STRING ? `${json.slice(0, MAX_STRING)}…` : json;
  }
  return String(v);
}

export function PayloadSummary({ payload }: { payload: unknown }) {
  const obj =
    typeof payload === 'object' && payload !== null && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;

  const rows = obj
    ? Object.entries(obj)
        .filter(([k]) => !NOISY_KEY.test(k))
        .map(([k, v]) => {
          let d = displayValue(v);
          if (d && ENUM_VALUE_KEY.test(k) && SLUG_VALUE.test(d)) d = prettifySlug(d);
          return [k, d] as const;
        })
        .filter((pair): pair is readonly [string, string] => pair[1] !== null)
    : [];

  return (
    <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {rows.length === 0 ? (
        <div style={{ fontSize: 11.5, color: 'var(--ink-5)' }}>
          Nothing to preview — &quot;view raw&quot; has the full payload.
        </div>
      ) : (
        rows.map(([k, v]) => (
          <div key={k}>
            <FieldLabel>{prettifyKey(k)}</FieldLabel>
            <div
              style={{
                color: 'var(--ink-2)',
                fontSize: 12.5,
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {isHttpUrl(v) ? (
                // source_url & friends — clickable instead of dead text.
                <a
                  href={v}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: 'var(--accent)',
                    textDecoration: 'none',
                    fontFamily: 'var(--f-mono)',
                    fontSize: 11.5,
                    wordBreak: 'break-all',
                  }}
                >
                  {v}
                </a>
              ) : (
                v
              )}
            </div>
          </div>
        ))
      )}
      <RawPayloadToggle payload={payload} />
    </div>
  );
}
