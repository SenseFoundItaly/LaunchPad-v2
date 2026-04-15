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
  const config = monitor.config ? JSON.parse(monitor.config) : {};

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
    health: 'text-green-400',
    competitor: 'text-red-400',
    market: 'text-blue-400',
    news: 'text-purple-400',
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/50" onClick={onClose} />
      <div className="w-[480px] bg-zinc-950 border-l border-zinc-800 flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between shrink-0">
          <div>
            <h3 className="text-sm font-semibold text-white">{monitor.name}</h3>
            <span className={`text-xs ${TYPE_COLORS[monitor.type] || 'text-zinc-400'}`}>{monitor.type}</span>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-lg">&times;</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Schedule */}
          <div>
            <label className="text-xs text-zinc-500 uppercase tracking-wider block mb-2">Schedule</label>
            <div className="flex gap-2">
              {['daily', 'weekly', 'monthly', 'manual'].map(s => (
                <button
                  key={s}
                  onClick={() => setSchedule(s)}
                  className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                    schedule === s
                      ? 'bg-blue-600 text-white'
                      : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Status */}
          <div>
            <label className="text-xs text-zinc-500 uppercase tracking-wider block mb-2">Status</label>
            <div className="flex gap-2">
              {['active', 'paused'].map(s => (
                <button
                  key={s}
                  onClick={() => setStatus(s)}
                  className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                    status === s
                      ? (s === 'active' ? 'bg-green-600 text-white' : 'bg-zinc-600 text-white')
                      : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Trigger keywords */}
          <div>
            <label className="text-xs text-zinc-500 uppercase tracking-wider block mb-2">Trigger Keywords</label>
            <p className="text-[10px] text-zinc-600 mb-2">Alert when these terms appear in results</p>
            <div className="flex gap-2 mb-2">
              <input
                value={keywordInput}
                onChange={(e) => setKeywordInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addKeyword())}
                placeholder="Add keyword..."
                className="flex-1 px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-600"
              />
              <button onClick={addKeyword} className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs rounded-lg">Add</button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {keywords.map((k, i) => (
                <span key={i} className="flex items-center gap-1 px-2 py-0.5 bg-blue-500/10 text-blue-400 text-xs rounded-full border border-blue-500/20">
                  {k}
                  <button onClick={() => setKeywords(keywords.filter((_, j) => j !== i))} className="text-blue-400/50 hover:text-blue-300">&times;</button>
                </span>
              ))}
            </div>
          </div>

          {/* Competitor names */}
          <div>
            <label className="text-xs text-zinc-500 uppercase tracking-wider block mb-2">Competitors to Track</label>
            <div className="flex gap-2 mb-2">
              <input
                value={competitorInput}
                onChange={(e) => setCompetitorInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addCompetitor())}
                placeholder="Company name..."
                className="flex-1 px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-600"
              />
              <button onClick={addCompetitor} className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs rounded-lg">Add</button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {competitors.map((c, i) => (
                <span key={i} className="flex items-center gap-1 px-2 py-0.5 bg-red-500/10 text-red-400 text-xs rounded-full border border-red-500/20">
                  {c}
                  <button onClick={() => setCompetitors(competitors.filter((_, j) => j !== i))} className="text-red-400/50 hover:text-red-300">&times;</button>
                </span>
              ))}
            </div>
          </div>

          {/* Alert threshold */}
          <div>
            <label className="text-xs text-zinc-500 uppercase tracking-wider block mb-2">Alert Threshold</label>
            <select
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              className="w-full px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-200 outline-none"
            >
              <option value="all">All findings</option>
              <option value="warning">Warning and above</option>
              <option value="critical">Critical only</option>
            </select>
          </div>

          {/* Custom prompt */}
          <div>
            <label className="text-xs text-zinc-500 uppercase tracking-wider block mb-2">Custom Prompt</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-600 resize-none"
              placeholder="What should this monitor look for?"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-zinc-800 shrink-0 space-y-2">
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white text-sm rounded-lg transition-colors"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button onClick={onClose} className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm rounded-lg transition-colors">
              Cancel
            </button>
          </div>
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-red-400">Delete this monitor?</span>
              <button onClick={handleDelete} className="text-xs px-3 py-1 bg-red-600 text-white rounded">Yes, delete</button>
              <button onClick={() => setConfirmDelete(false)} className="text-xs px-3 py-1 bg-zinc-800 text-zinc-400 rounded">No</button>
            </div>
          ) : (
            <button onClick={() => setConfirmDelete(true)} className="w-full text-center text-xs text-zinc-600 hover:text-red-400 transition-colors py-1">
              Delete monitor
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
