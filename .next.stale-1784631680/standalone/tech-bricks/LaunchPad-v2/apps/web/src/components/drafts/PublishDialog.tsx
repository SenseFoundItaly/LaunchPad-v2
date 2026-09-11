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
      <div className="bg-paper-2 border border-line-2 rounded-xl p-6 w-full max-w-md">
        <h3 className="text-ink font-semibold mb-4">Publish Draft</h3>

        <label className="block text-sm text-ink-4 mb-1">URL Slug</label>
        <div className="flex items-center gap-1 mb-2">
          <span className="text-xs text-ink-5">/published/</span>
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
            className="flex-1 bg-paper-3 border border-line-2 rounded px-3 py-1.5 text-sm text-ink-2 focus:outline-none focus:border-moss"
            placeholder="my-startup-page"
          />
        </div>

        <p className="text-xs text-ink-5 mb-4">
          Your page will be available at <span className="text-ink-3">/published/{slug || '...'}</span>
        </p>

        {error && (
          <div className="bg-clay-wash border border-clay/30 rounded px-3 py-2 mb-4 text-clay text-xs">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-ink-4 hover:text-ink-2 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handlePublish}
            disabled={!slug || publishing}
            className="px-4 py-2 bg-moss hover:bg-moss/80 disabled:bg-paper-3 text-on-accent rounded-lg text-sm font-medium transition-colors"
          >
            {publishing ? 'Publishing...' : 'Publish'}
          </button>
        </div>
      </div>
    </div>
  );
}
