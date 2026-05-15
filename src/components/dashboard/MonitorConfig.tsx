'use client';

import { useState } from 'react';
import api from '@/api';

interface MonitorConfigProps {
  monitor: {
    id: string;
    type: string;
    name: string;
    schedule: string;
    prompt: string;
    config: string | null;
    status: string;
  };
  projectId: string;
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;
}

export default function MonitorConfig({ monitor, projectId, onClose, onSave, onDelete }: MonitorConfigProps) {
  const config = monitor.config
    ? (typeof monitor.config === 'string' ? JSON.parse(monitor.config) : monitor.config)
    : {};

  const [schedule, setSchedule] = useState(monitor.schedule || 'weekly');
  const [prompt, setPrompt] = useState(monitor.prompt || '');
  const [status, setStatus] = useState(monitor.status || 'active');
  const [keywords, setKeywords] = useState<string[]>(config.keywords || []);
  const [competitors, setCompetitors] = useState<string[]>(config.competitors || []);
  const [threshold, setThreshold] = useState<string>(config.threshold || 'all');
  const [keywordInput, setKeywordInput] = useState('');
  const [competitorInput, setCompetitorInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function addKeyword() {
    const k = keywordInput.trim();
    if (k && !keywords.includes(k)) {
      setKeywords([...keywords, k]);
      setKeywordInput('');
    }
  }

  function addCompetitor() {
    const c = competitorInput.trim();
    if (c && !competitors.includes(c)) {
      setCompetitors([...competitors, c]);
      setCompetitorInput('');
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await api.put(`/api/projects/${projectId}/monitors/${monitor.id}`, {
        schedule,
        prompt,
        status,
        config: { keywords, competitors, threshold },
      });
      onSave();
    } catch (err) {
      console.error('Failed to save monitor:', err);
    }
    setSaving(false);
  }

  async function handleDelete() {
    try {
      await api.delete(`/api/projects/${projectId}/monitors/${monitor.id}`);
      onDelete();
    } catch (err) {
      console.error('Failed to delete monitor:', err);
    }
  }

  const TYPE_COLORS: Record<string, string> = {
    health: 'text-moss',
    competitor: 'text-clay',
    market: 'text-sky',
    news: 'text-plum',
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/50" onClick={onClose} />
      <div className="w-[480px] bg-surface-sunk border-l border-line flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-line flex items-center justify-between shrink-0">
          <div>
            <h3 className="text-sm font-semibold text-ink">{monitor.name}</h3>
            <span className={`text-xs ${TYPE_COLORS[monitor.type] || 'text-ink-4'}`}>{monitor.type}</span>
          </div>
          <button onClick={onClose} className="text-ink-5 hover:text-ink-3 text-lg">&times;</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Schedule */}
          <div>
            <label className="text-xs text-ink-5 uppercase tracking-wider block mb-2">Schedule</label>
            <div className="flex gap-2">
              {['daily', 'weekly', 'monthly', 'manual'].map(s => (
                <button
                  key={s}
                  onClick={() => setSchedule(s)}
                  className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                    schedule === s
                      ? 'bg-moss text-ink'
                      : 'bg-paper-2 text-ink-4 hover:bg-paper-3'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Status */}
          <div>
            <label className="text-xs text-ink-5 uppercase tracking-wider block mb-2">Status</label>
            <div className="flex gap-2">
              {['active', 'paused'].map(s => (
                <button
                  key={s}
                  onClick={() => setStatus(s)}
                  className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                    status === s
                      ? (s === 'active' ? 'bg-moss text-ink' : 'bg-ink-6 text-ink')
                      : 'bg-paper-2 text-ink-4 hover:bg-paper-3'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Trigger keywords */}
          <div>
            <label className="text-xs text-ink-5 uppercase tracking-wider block mb-2">Trigger Keywords</label>
            <p className="text-[10px] text-ink-6 mb-2">Alert when these terms appear in results</p>
            <div className="flex gap-2 mb-2">
              <input
                value={keywordInput}
                onChange={(e) => setKeywordInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addKeyword())}
                placeholder="Add keyword..."
                className="flex-1 px-3 py-1.5 bg-paper border border-line rounded-lg text-xs text-ink-2 placeholder-ink-6 outline-none focus:border-ink-6"
              />
              <button onClick={addKeyword} className="px-3 py-1.5 bg-paper-2 hover:bg-paper-3 text-ink-3 text-xs rounded-lg">Add</button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {keywords.map((k, i) => (
                <span key={i} className="flex items-center gap-1 px-2 py-0.5 bg-sky/10 text-sky text-xs rounded-full border border-sky/20">
                  {k}
                  <button onClick={() => setKeywords(keywords.filter((_, j) => j !== i))} className="text-sky/50 hover:text-sky/80">&times;</button>
                </span>
              ))}
            </div>
          </div>

          {/* Competitor names */}
          <div>
            <label className="text-xs text-ink-5 uppercase tracking-wider block mb-2">Competitors to Track</label>
            <div className="flex gap-2 mb-2">
              <input
                value={competitorInput}
                onChange={(e) => setCompetitorInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addCompetitor())}
                placeholder="Company name..."
                className="flex-1 px-3 py-1.5 bg-paper border border-line rounded-lg text-xs text-ink-2 placeholder-ink-6 outline-none focus:border-ink-6"
              />
              <button onClick={addCompetitor} className="px-3 py-1.5 bg-paper-2 hover:bg-paper-3 text-ink-3 text-xs rounded-lg">Add</button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {competitors.map((c, i) => (
                <span key={i} className="flex items-center gap-1 px-2 py-0.5 bg-clay/10 text-clay text-xs rounded-full border border-clay/20">
                  {c}
                  <button onClick={() => setCompetitors(competitors.filter((_, j) => j !== i))} className="text-clay/50 hover:text-clay/80">&times;</button>
                </span>
              ))}
            </div>
          </div>

          {/* Alert threshold */}
          <div>
            <label className="text-xs text-ink-5 uppercase tracking-wider block mb-2">Alert Threshold</label>
            <select
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              className="w-full px-3 py-1.5 bg-paper border border-line rounded-lg text-xs text-ink-2 outline-none"
            >
              <option value="all">All findings</option>
              <option value="warning">Warning and above</option>
              <option value="critical">Critical only</option>
            </select>
          </div>

          {/* Custom prompt */}
          <div>
            <label className="text-xs text-ink-5 uppercase tracking-wider block mb-2">Custom Prompt</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 bg-paper border border-line rounded-lg text-xs text-ink-2 placeholder-ink-6 outline-none focus:border-ink-6 resize-none"
              placeholder="What should this monitor look for?"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-line shrink-0 space-y-2">
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 py-2 bg-moss hover:bg-moss/80 disabled:bg-paper-3 text-ink text-sm rounded-lg transition-colors"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button onClick={onClose} className="px-4 py-2 bg-paper-2 hover:bg-paper-3 text-ink-3 text-sm rounded-lg transition-colors">
              Cancel
            </button>
          </div>
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-clay">Delete this monitor?</span>
              <button onClick={handleDelete} className="text-xs px-3 py-1 bg-clay text-ink rounded">Yes, delete</button>
              <button onClick={() => setConfirmDelete(false)} className="text-xs px-3 py-1 bg-paper-2 text-ink-4 rounded">No</button>
            </div>
          ) : (
            <button onClick={() => setConfirmDelete(true)} className="w-full text-center text-xs text-ink-6 hover:text-clay transition-colors py-1">
              Delete monitor
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
