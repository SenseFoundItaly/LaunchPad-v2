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
    return <div className="flex items-center justify-center h-full text-ink-5 text-sm">Loading draft...</div>;
  }

  if (!draft) {
    return <div className="flex items-center justify-center h-full text-ink-5 text-sm">Draft not found</div>;
  }

  const currentVersion = draft.versions.find((v) => v.version_number === selectedVersion);
  const previewHtml = currentVersion?.rendered_html || '';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-line">
        <div>
          <h3 className="text-sm font-semibold text-ink">{draft.name}</h3>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[11px] text-ink-5">{draft.draft_type}</span>
            <span className="text-[11px] text-ink-6">v{draft.current_version}</span>
            {draft.published_url && (
              <a href={draft.published_url} target="_blank" rel="noopener" className="text-[11px] text-sky hover:underline">
                Published
              </a>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowPublish(true)}
            className="px-3 py-1.5 bg-moss hover:bg-moss/80 text-on-accent rounded-md text-xs font-medium transition-colors"
          >
            Publish
          </button>
        </div>
      </div>

      {/* Version timeline */}
      <div className="flex gap-1 px-4 py-2 border-b border-line overflow-x-auto">
        {draft.versions.map((v) => (
          <button
            key={v.id}
            onClick={() => setSelectedVersion(v.version_number)}
            className={`shrink-0 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              selectedVersion === v.version_number
                ? 'bg-moss text-on-accent'
                : 'bg-paper-3 text-ink-4 hover:text-ink-2'
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
          <div className="flex items-center justify-center h-full text-ink-5 text-sm">
            No preview available for this version
          </div>
        )}
      </div>

      {/* Iterate bar */}
      <div className="border-t border-line px-4 py-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) handleIterate(); }}
            placeholder="Describe changes... (e.g., 'make the hero section more compelling')"
            className="flex-1 bg-paper-3 border border-line-2 rounded-lg px-3 py-2 text-sm text-ink-2 placeholder-ink-5 focus:outline-none focus:border-moss"
          />
          <button
            onClick={handleIterate}
            disabled={iterating || !feedback.trim()}
            className="px-4 py-2 bg-moss hover:bg-moss/80 disabled:bg-paper-3 text-on-accent rounded-lg text-sm font-medium transition-colors"
          >
            {iterating ? 'Iterating...' : 'Iterate'}
          </button>
        </div>
        {currentVersion?.changelog && (
          <p className="text-[11px] text-ink-5 mt-1.5">
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
