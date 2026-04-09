'use client';

import { use, useEffect, useState } from 'react';
import api from '@/api';
import DraftList from '@/components/drafts/DraftList';
import DraftEditor from '@/components/drafts/DraftEditor';

interface Draft {
  id: string;
  name: string;
  draft_type: string;
  status: string;
  current_version: number;
  published_url: string | null;
  updated_at: string;
}

export default function DraftsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadDrafts() {
    setLoading(true);
    const { data } = await api.get(`/api/drafts?project_id=${projectId}`);
    if (data.success) {
      setDrafts(data.data);
      if (!selectedDraftId && data.data.length > 0) {
        setSelectedDraftId(data.data[0].id);
      }
    }
    setLoading(false);
  }

  useEffect(() => { loadDrafts(); }, [projectId]);

  async function handleGenerateLandingPage() {
    await api.post('/api/tools', {
      tool_name: 'generate-landing-page',
      params: { style: 'modern', include_cta: true },
      project_id: projectId,
    });
    await loadDrafts();
  }

  async function handleGeneratePitchDeck() {
    await api.post('/api/tools', {
      tool_name: 'generate-pitch-deck',
      params: { slide_count: 10, audience: 'investor' },
      project_id: projectId,
    });
    await loadDrafts();
  }

  async function handleGenerateOnePager() {
    await api.post('/api/tools', {
      tool_name: 'generate-one-pager',
      params: { format: 'investor' },
      project_id: projectId,
    });
    await loadDrafts();
  }

  return (
    <div className="flex h-full">
      {/* Left panel — draft list */}
      <div className="w-72 shrink-0 border-r border-zinc-800 flex flex-col h-full">
        <div className="px-4 py-3 border-b border-zinc-800">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Drafts</h3>
            <span className="text-xs text-zinc-500">{drafts.length}</span>
          </div>
        </div>

        {/* Quick generate buttons */}
        <div className="px-3 py-2 border-b border-zinc-800 space-y-1">
          <button
            onClick={handleGenerateLandingPage}
            className="w-full text-left px-2.5 py-1.5 rounded-md text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
          >
            + Landing Page
          </button>
          <button
            onClick={handleGeneratePitchDeck}
            className="w-full text-left px-2.5 py-1.5 rounded-md text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
          >
            + Pitch Deck
          </button>
          <button
            onClick={handleGenerateOnePager}
            className="w-full text-left px-2.5 py-1.5 rounded-md text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
          >
            + One-Pager
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="text-center py-8 text-zinc-500 text-sm">Loading...</div>
          ) : (
            <DraftList
              drafts={drafts}
              selectedId={selectedDraftId || undefined}
              onSelect={setSelectedDraftId}
            />
          )}
        </div>
      </div>

      {/* Right panel — editor */}
      <div className="flex-1 min-w-0">
        {selectedDraftId ? (
          <DraftEditor draftId={selectedDraftId} projectId={projectId} />
        ) : (
          <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
            <div className="text-center">
              <p>Select a draft or generate a new one.</p>
              <p className="mt-1 text-xs">You can also generate drafts from the chat.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
