'use client';

import { useState } from 'react';

interface PublishDialogProps {
  draftId: string;
  draftName: string;
  onPublish: (slug: string) => Promise<void>;
  onClose: () => void;
}

export default function PublishDialog({ draftId, draftName, onPublish, onClose }: PublishDialogProps) {
  const [slug, setSlug] = useState(
    draftName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
  );
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePublish() {
    if (!slug) return;
    setPublishing(true);
    setError(null);
    try {
      await onPublish(slug);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to publish');
      setPublishing(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-full max-w-md">
        <h3 className="text-white font-semibold mb-4">Publish Draft</h3>

        <label className="block text-sm text-zinc-400 mb-1">URL Slug</label>
        <div className="flex items-center gap-1 mb-2">
          <span className="text-xs text-zinc-500">/published/</span>
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-blue-500"
            placeholder="my-startup-page"
          />
        </div>

        <p className="text-xs text-zinc-500 mb-4">
          Your page will be available at <span className="text-zinc-300">/published/{slug || '...'}</span>
        </p>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded px-3 py-2 mb-4 text-red-400 text-xs">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handlePublish}
            disabled={!slug || publishing}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {publishing ? 'Publishing...' : 'Publish'}
          </button>
        </div>
      </div>
    </div>
  );
}
