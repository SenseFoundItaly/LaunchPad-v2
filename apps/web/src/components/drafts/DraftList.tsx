'use client';

interface Draft {
  id: string;
  name: string;
  draft_type: string;
  status: string;
  current_version: number;
  published_url: string | null;
  updated_at: string;
}

interface DraftListProps {
  drafts: Draft[];
  onSelect: (draftId: string) => void;
  selectedId?: string;
}

const typeIcons: Record<string, string> = {
  'landing-page': '\u{1F310}',
  'pitch-deck': '\u{1F4CA}',
  'one-pager': '\u{1F4C4}',
  document: '\u{1F4DD}',
  website: '\u{1F5A5}\u{FE0F}',
};

const statusColors: Record<string, string> = {
  draft: 'bg-ink-6 text-ink-3',
  review: 'bg-accent-wash text-accent',
  published: 'bg-moss-wash text-moss',
  archived: 'bg-paper-3 text-ink-5',
};

export default function DraftList({ drafts, onSelect, selectedId }: DraftListProps) {
  if (drafts.length === 0) {
    return (
      <div className="text-center py-12 text-ink-5 text-sm">
        <p>No drafts yet.</p>
        <p className="mt-1 text-xs">Generate a landing page, pitch deck, or one-pager from the chat.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {drafts.map((draft) => (
        <button
          key={draft.id}
          onClick={() => onSelect(draft.id)}
          className={`w-full text-left p-3 rounded-lg border transition-colors ${
            selectedId === draft.id
              ? 'bg-paper-3 border-line-2'
              : 'bg-paper-2 border-line hover:border-line-2'
          }`}
        >
          <div className="flex items-start gap-2.5">
            <span className="text-lg mt-0.5">{typeIcons[draft.draft_type] || '\u{1F4C4}'}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-medium text-ink-2 truncate">{draft.name}</h4>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${statusColors[draft.status] || statusColors.draft}`}>
                  {draft.status}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-1 text-[11px] text-ink-5">
                <span>v{draft.current_version}</span>
                <span>{draft.draft_type}</span>
                <span>{new Date(draft.updated_at).toLocaleDateString()}</span>
              </div>
              {draft.published_url && (
                <div className="mt-1 text-[11px] text-sky truncate">
                  {draft.published_url}
                </div>
              )}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
