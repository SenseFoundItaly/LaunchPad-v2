'use client';

/**
 * NewWatcherForm — the founder-driven "+ New watcher" routine, modeled on a
 * Claude Code cloud routine: a small inline form that creates a recurring
 * watcher. Fields:
 *   - name        (required)
 *   - prompt      (what the watcher is asked each tick — stored as objective+prompt)
 *   - cadence     (daily | weekly)
 *   - time_of_day (HH:MM — anchors the first run's clock time)
 *   - enabled     (toggle → status active/paused)
 *
 * Submitting POSTs to /api/projects/:projectId/monitors (the existing
 * founder-create endpoint). On success it invalidates the ['watchers', …]
 * cache so MonitorListPanel re-renders with the new row, and broadcasts
 * lp-actions-changed for any other listeners. Disabled watchers are created
 * active then immediately paused (the create endpoint always inserts active),
 * matching the toggle.
 *
 * Design language: CSS custom properties + inline styles, matching the
 * surrounding /actions page. No Tailwind.
 */

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Icon, I } from '@/components/design/primitives';
import { watcherWeeklyLabel, watcherRunsPerWeek } from '@/lib/watcher-cost';
import { useT } from '@/components/providers/LocaleProvider';

type Cadence = 'daily' | 'weekly';

export default function NewWatcherForm({ projectId }: { projectId: string }) {
  const t = useT();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [cadence, setCadence] = useState<Cadence>('weekly');
  const [timeOfDay, setTimeOfDay] = useState('09:00');
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function reset() {
    setName('');
    setPrompt('');
    setCadence('weekly');
    setTimeOfDay('09:00');
    setEnabled(true);
    setErr(null);
  }

  async function submit() {
    if (busy) return;
    const trimmedName = name.trim();
    if (!trimmedName) { setErr(t('monitors.name-required')); return; }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/monitors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          objective: prompt.trim() || null,
          prompt: prompt.trim() || null,
          schedule: cadence,
          time_of_day: timeOfDay,
          type: 'ecosystem.custom',
        }),
      });
      const body = await res.json();
      if (!res.ok || !body?.success) throw new Error(body?.error || `HTTP ${res.status}`);

      // Disabled toggle: the create endpoint always inserts active, so pause
      // it right after if the founder left the toggle off.
      if (!enabled && body?.data?.id) {
        await fetch(`/api/projects/${projectId}/monitors/${body.data.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'paused' }),
        });
      }

      await qc.invalidateQueries({ queryKey: ['watchers', projectId] });
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('lp-actions-changed'));
      }
      reset();
      setOpen(false);
    } catch (e) {
      setErr((e as Error).message || t('monitors.create-failed'));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 12,
          fontWeight: 500,
          color: 'var(--accent-ink)',
          background: 'var(--accent-wash)',
          padding: '6px 10px',
          borderRadius: 6,
          border: 'none',
          cursor: 'pointer',
          fontFamily: 'var(--f-sans)',
        }}
      >
        <Icon d={I.plus} size={13} /> {t('monitors.new-watcher')}
      </button>
    );
  }

  return (
    <div
      style={{
        border: '1px solid var(--line)',
        borderRadius: 8,
        background: 'var(--surface)',
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        minWidth: 320,
        width: 360,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', flex: 1 }}>{t('monitors.new-watcher')}</span>
        <button
          type="button"
          onClick={() => { setOpen(false); reset(); }}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-5)', fontSize: 12 }}
        >
          {t('common.cancel')}
        </button>
      </div>

      <Field label={t('monitors.field-name')}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('monitors.name-placeholder')}
          style={inputStyle}
        />
      </Field>

      <Field label={t('monitors.field-prompt')}>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t('monitors.prompt-placeholder')}
          rows={3}
          style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
        />
      </Field>

      <div style={{ display: 'flex', gap: 10 }}>
        <Field label={t('monitors.field-cadence')}>
          <select
            value={cadence}
            onChange={(e) => setCadence(e.target.value as Cadence)}
            style={inputStyle}
          >
            <option value="daily">{t('monitors.cadence-daily')}</option>
            <option value="weekly">{t('monitors.cadence-weekly')}</option>
          </select>
        </Field>
        <Field label={t('monitors.field-time-of-day')}>
          <input
            type="time"
            value={timeOfDay}
            onChange={(e) => setTimeOfDay(e.target.value)}
            style={inputStyle}
          />
        </Field>
      </div>

      {/* Estimated weekly spend — updates live with the cadence so the founder
          sees the cost before creating the watcher. */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 11 }}>
        <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
          {t('monitors.est-usage')}
        </span>
        <span style={{ color: 'var(--ink-3)', fontWeight: 500 }}>{watcherWeeklyLabel(cadence)}</span>
        <span style={{ color: 'var(--ink-5)' }}>
          · {watcherRunsPerWeek(cadence) === 1
            ? t('monitors.runs-per-week-one', { n: 1 })
            : t('monitors.runs-per-week-other', { n: watcherRunsPerWeek(cadence) })}
        </span>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ink-3)', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        {t('monitors.enabled-label')}
      </label>

      {err && <div style={{ fontSize: 11.5, color: 'var(--clay)' }}>{err}</div>}

      <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit()}
          style={{
            fontSize: 12,
            padding: '6px 14px',
            borderRadius: 6,
            border: 'none',
            background: 'var(--moss)',
            color: 'var(--paper)',
            cursor: busy ? 'not-allowed' : 'pointer',
            opacity: busy ? 0.6 : 1,
            fontFamily: 'var(--f-sans)',
          }}
        >
          {busy ? t('monitors.creating') : t('monitors.create-watcher')}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span
        className="lp-mono"
        style={{ fontSize: 10, color: 'var(--ink-5)', textTransform: 'uppercase', letterSpacing: 0.4 }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '6px 8px',
  fontSize: 12,
  borderRadius: 6,
  border: '1px solid var(--line-2)',
  background: 'var(--paper)',
  color: 'var(--ink-2)',
  fontFamily: 'var(--f-sans)',
  outline: 'none',
};
