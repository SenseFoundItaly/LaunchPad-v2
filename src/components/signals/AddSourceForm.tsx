'use client';

import { useState } from 'react';
import { Icon, I } from '@/components/design/primitives';

interface AddSourceFormProps {
  projectId: string;
  onAdded: () => void;
}

const CATEGORIES = [
  { value: 'competitor_pricing', label: 'Competitor pricing' },
  { value: 'competitor_product', label: 'Competitor product' },
  { value: 'careers_page', label: 'Careers page' },
  { value: 'social_feed', label: 'Social feed' },
  { value: 'review_site', label: 'Review site' },
  { value: 'patent_database', label: 'Patent database' },
  { value: 'regulatory', label: 'Regulatory' },
  { value: 'news', label: 'News' },
  { value: 'custom', label: 'Custom' },
];

const SCHEDULES = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'hourly', label: 'Hourly' },
  { value: 'manual', label: 'Manual only' },
];

export function AddSourceForm({ projectId, onAdded }: AddSourceFormProps) {
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState('custom');
  const [schedule, setSchedule] = useState('daily');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url || !label) return;

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/projects/${projectId}/watch-sources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, label, category, schedule }),
      });
      const body = await res.json();
      if (!body.success) {
        setError(body.error || 'Failed to add source');
        return;
      }
      setUrl('');
      setLabel('');
      setCategory('custom');
      setSchedule('daily');
      onAdded();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="url"
          placeholder="https://competitor.com/pricing"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
          style={inputStyle}
        />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          placeholder="Label (e.g., Acme Pricing)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          required
          style={{ ...inputStyle, flex: 1 }}
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          style={selectStyle}
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
        <select
          value={schedule}
          onChange={(e) => setSchedule(e.target.value)}
          style={selectStyle}
        >
          {SCHEDULES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="submit"
          disabled={submitting || !url || !label}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '7px 14px',
            borderRadius: 'var(--r-m)',
            background: 'var(--ink)',
            color: 'var(--paper)',
            border: 'none',
            cursor: submitting ? 'wait' : 'pointer',
            fontSize: 12,
            fontFamily: 'var(--f-sans)',
            fontWeight: 500,
            opacity: submitting || !url || !label ? 0.5 : 1,
          }}
        >
          <Icon d={I.plus} size={12} />
          {submitting ? 'Adding…' : 'Add source'}
        </button>
        {error && (
          <span style={{ fontSize: 11, color: 'var(--clay)' }}>{error}</span>
        )}
      </div>
    </form>
  );
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: '7px 10px',
  border: '1px solid var(--line-2)',
  borderRadius: 6,
  background: 'var(--paper)',
  color: 'var(--ink)',
  fontSize: 12,
  fontFamily: 'var(--f-sans)',
  outline: 'none',
};

const selectStyle: React.CSSProperties = {
  padding: '7px 8px',
  border: '1px solid var(--line-2)',
  borderRadius: 6,
  background: 'var(--paper)',
  color: 'var(--ink)',
  fontSize: 11,
  fontFamily: 'var(--f-sans)',
  outline: 'none',
  cursor: 'pointer',
};
