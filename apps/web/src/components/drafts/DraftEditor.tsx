'use client';

import { useState, useEffect } from 'react';
import DraftPreview from './DraftPreview';
import PublishDialog from './PublishDialog';
import api from '@/api';

interface Version {
  id: string;
  version_number: number;
  content_type: string;
  rendered_html: string | null;
  changelog: string | null;
  created_by: string;
  created_at: string;
}

interface DraftData {
  id: string;
  project_id: string;
  name: string;
  draft_type: string;
  status: string;
  current_version: number;
  published_url: string | null;
  versions: Version[];
}

interface DraftEditorProps {
  draftId: string;
  projectId: string;
}

export default function DraftEditor({ draftId, projectId }: DraftEditorProps) {
  const [draft, setDraft] = useState<DraftData | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [feedback, setFeedback] = useState('');
  const [iterating, setIterating] = useState(false);
  const [showPublish, setShowPublish] = useState(false);
  const [loading, setLoading] = useState(true);

  async function loadDraft() {
    setLoading(true);
    const { data } = await api.get(`/api/drafts/${draftId}`);
    if (data.success) {
      setDraft(data.data);
      setSelectedVersion(data.data.current_version);
    }
    setLoading(false);
  }

  useEffect(() => { loadDraft(); }, [draftId]);

  async function handleIterate() {
    if (!feedback.trim() || !draft) return;
    setIterating(true);
    try {
      await api.post(`/api/drafts/${draftId}/versions`, {
        feedback,
        project_id: projectId,
      });
      setFeedback('');
      await loadDraft();
    } finally {
      setIterating(false);
    }
  }

  async function handlePublish(slug: string) {
    await api.post(`/api/drafts/${draftId}/publish`, { slug });
    await loadDraft();
    setShowPublish(false);
  }

  if (loading) {
    return <div className="flex items-center justify-center h-full text-zinc-500 text-sm">Loading draft...</div>;
  }

  if (!draft) {
    return <div className="flex items-center justify-center h-full text-zinc-500 text-sm">Draft not found</div>;
  }

  const currentVersion = draft.versions.find((v) => v.version_number === selectedVersion);
  const previewHtml = currentVersion?.rendered_html || '';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <div>
          <h3 className="text-sm font-semibold text-white">{draft.name}</h3>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[11px] text-zinc-500">{draft.draft_type}</span>
            <span className="text-[11px] text-zinc-600">v{draft.current_version}</span>
            {draft.published_url && (
              <a href={draft.published_url} target="_blank" rel="noopener" className="text-[11px] text-blue-400 hover:underline">
                Published
              </a>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowPublish(true)}
            className="px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white rounded-md text-xs font-medium transition-colors"
          >
            Publish
          </button>
        </div>
      </div>

      {/* Version timeline */}
      <div className="flex gap-1 px-4 py-2 border-b border-zinc-800 overflow-x-auto">
        {draft.versions.map((v) => (
          <button
            key={v.id}
            onClick={() => setSelectedVersion(v.version_number)}
            className={`shrink-0 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              selectedVersion === v.version_number
                ? 'bg-blue-600 text-white'
                : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            v{v.version_number}
          </button>
        ))}
      </div>

      {/* Preview area */}
      <div className="flex-1 overflow-hidden p-4">
        {previewHtml ? (
          <DraftPreview html={previewHtml} />
        ) : (
          <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
            No preview available for this version
          </div>
        )}
      </div>

      {/* Iterate bar */}
      <div className="border-t border-zinc-800 px-4 py-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) handleIterate(); }}
            placeholder="Describe changes... (e.g., 'make the hero section more compelling')"
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={handleIterate}
            disabled={iterating || !feedback.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {iterating ? 'Iterating...' : 'Iterate'}
          </button>
        </div>
        {currentVersion?.changelog && (
          <p className="text-[11px] text-zinc-500 mt-1.5">
            Last change: {currentVersion.changelog}
          </p>
        )}
      </div>

      {showPublish && (
        <PublishDialog
          draftId={draftId}
          draftName={draft.name}
          onPublish={handlePublish}
          onClose={() => setShowPublish(false)}
        />
      )}
    </div>
  );
}
