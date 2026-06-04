'use client';

/**
 * DataRoomPanel — list + detail of all project documents.
 *
 * Left column: scrollable list of every uploaded file and generated deliverable.
 * Right column: detail view of the selected item. Generated docs are editable
 * (textarea + Save → PATCH → in-place UPDATE) and exportable to PDF via the
 * existing openPrintPreview path. Uploaded files are read-only — they're
 * source material, not deliverables.
 *
 * Backed by GET /api/projects/{projectId}/data-room and its sibling [itemId]
 * route. Both use ownership-by-project semantics: one verifyOwner check per
 * request, then project_id is the boundary.
 */

import { useState, useMemo } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Icon, I, IconBtn, Pill } from '@/components/design/primitives';
import { openPrintPreview } from '@/lib/print-utils';

interface DataRoomItem {
  id: string;
  source: 'uploaded' | 'generated';
  kind: string;
  title: string;
  doc_type: string | null;
  created_at: string;
  size_bytes: number | null;
  mime: string | null;
  has_editable_content: boolean;
}

interface DataRoomDetail {
  id: string;
  source: 'uploaded' | 'generated';
  title: string;
  content: string;
  kind: string;
  doc_type: string | null;
  metadata: Record<string, unknown>;
  sources: unknown[];
  created_at: string;
  editable: boolean;
}

interface DataRoomListResponse { items: DataRoomItem[] }

export default function DataRoomPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  // Only the user's explicit click is state. The auto-fallback to "first item"
  // is a derivation (effectiveId below) so the list re-rendering can never
  // get out of sync with the selection. setState-in-effect was banned for
  // exactly this kind of mirror-and-sync pattern.
  const [clickedId, setClickedId] = useState<string | null>(null);

  const { data: list, isLoading } = useQuery<DataRoomListResponse>({
    queryKey: ['data-room', projectId, 'list'],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/data-room`);
      const body = await res.json();
      if (!res.ok || body?.success === false) throw new Error(body?.error || `HTTP ${res.status}`);
      return body.data;
    },
  });

  const presented = useMemo(
    () => presentItems(list?.items ?? []),
    [list?.items],
  );

  // Effective selection: explicit click wins, otherwise first item if any.
  // If clickedId points at an item that no longer exists (deleted from
  // another tab, or filtered out), fall through to the top of the list.
  const clickedStillExists = clickedId !== null && presented.some((p) => p.id === clickedId);
  const effectiveId =
    clickedStillExists ? clickedId : presented[0]?.id ?? null;

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, background: 'var(--paper)' }}>
      {/* List column */}
      <div
        style={{
          width: 340,
          flexShrink: 0,
          borderRight: '1px solid var(--line)',
          overflow: 'auto',
          padding: '14px 0',
        }}
      >
        <div style={{ padding: '0 16px 10px', display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)', letterSpacing: 0.5 }}>
            DATA ROOM
          </span>
          {presented.length > 0 && (
            <span style={{ fontSize: 11, color: 'var(--ink-5)' }}>· {presented.length} items</span>
          )}
        </div>

        {isLoading ? (
          <EmptyHint message="Loading…" />
        ) : presented.length === 0 ? (
          <EmptyHint message="Nothing here yet. Upload files on the Review tab or generate a pitch deck / one-pager / landing page from chat." />
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {presented.map((item) => (
              <li key={item.id}>
                <button
                  onClick={() => setClickedId(item.id)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '10px 16px',
                    border: 'none',
                    borderLeft: effectiveId === item.id ? '2px solid var(--accent)' : '2px solid transparent',
                    background: effectiveId === item.id ? 'var(--accent-wash)' : 'transparent',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Icon d={item.icon} size={12} stroke={1.5} style={{ color: 'var(--ink-3)' }} />
                    <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-1)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.displayTitle}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: 'var(--ink-5)' }}>
                    <Pill kind={item.source === 'generated' ? 'info' : 'n'}>
                      {item.sourceBadge}
                    </Pill>
                    {item.typeBadge && (
                      <span className="lp-mono" style={{ background: 'var(--paper-2)', padding: '1px 5px', borderRadius: 3 }}>
                        {item.typeBadge}
                      </span>
                    )}
                    <span style={{ marginLeft: 'auto' }}>{item.relativeDate}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Detail column */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {effectiveId ? (
          <DataRoomDetailView
            projectId={projectId}
            itemId={effectiveId}
            onDeleted={() => {
              setClickedId(null);
              void qc.invalidateQueries({ queryKey: ['data-room', projectId] });
            }}
          />
        ) : (
          <EmptyHint message="Select an item on the left to view it." />
        )}
      </div>
    </div>
  );
}

function DataRoomDetailView({
  projectId,
  itemId,
  onDeleted,
}: {
  projectId: string;
  itemId: string;
  onDeleted: () => void;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);

  const { data: detail, isLoading, isError } = useQuery<DataRoomDetail>({
    queryKey: ['data-room', projectId, 'item', itemId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/data-room/${itemId}`);
      const body = await res.json();
      if (!res.ok || body?.success === false) throw new Error(body?.error || `HTTP ${res.status}`);
      return body.data as DataRoomDetail;
    },
    // Don't re-fetch a 404'd item — when an item is deleted and effectiveId
    // briefly points at the stale id before the list refetches and re-selects,
    // a retry loop would mask the real state.
    retry: false,
  });

  const saveMutation = useMutation({
    mutationFn: async (content: string) => {
      const res = await fetch(`/api/projects/${projectId}/data-room/${itemId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const body = await res.json();
      if (!res.ok || body?.success === false) throw new Error(body?.error || `HTTP ${res.status}`);
    },
    onSuccess: () => {
      setEditing(false);
      setDraft(null);
      void qc.invalidateQueries({ queryKey: ['data-room', projectId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/data-room/${itemId}`, { method: 'DELETE' });
      const body = await res.json();
      if (!res.ok || body?.success === false) throw new Error(body?.error || `HTTP ${res.status}`);
    },
    onSuccess: onDeleted,
  });

  if (isError) return <EmptyHint message="This document is no longer available." />;
  if (isLoading || !detail) return <EmptyHint message="Loading…" />;

  const content = draft ?? detail.content;

  return (
    <>
      <div
        style={{
          padding: '12px 20px',
          borderBottom: '1px solid var(--line)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {detail.title}
          </div>
          <div className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)', marginTop: 2 }}>
            {detail.source === 'generated' ? (detail.doc_type ?? detail.kind) : 'uploaded file'}
            {' · '}
            {new Date(detail.created_at).toLocaleString()}
          </div>
        </div>
        {detail.editable && !editing && (
          <IconBtn d={I.edit} title="Edit" onClick={() => { setDraft(detail.content); setEditing(true); }} />
        )}
        {detail.editable && editing && (
          <button
            onClick={() => saveMutation.mutate(content)}
            disabled={saveMutation.isPending}
            style={{
              fontSize: 11,
              padding: '4px 10px',
              border: '1px solid var(--accent)',
              background: 'var(--accent)',
              color: 'white',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            {saveMutation.isPending ? 'Saving…' : 'Save'}
          </button>
        )}
        {editing && (
          <button
            onClick={() => { setEditing(false); setDraft(null); }}
            style={{ fontSize: 11, padding: '4px 10px', border: '1px solid var(--line)', background: 'transparent', borderRadius: 4, cursor: 'pointer' }}
          >
            Cancel
          </button>
        )}
        <IconBtn
          d={I.printer}
          title="Print / PDF"
          onClick={() => openPrintPreview(detail.title, content)}
        />
        <IconBtn
          d={I.trash}
          title="Delete"
          onClick={() => {
            if (confirm(`Delete "${detail.title}"? This cannot be undone.`)) deleteMutation.mutate();
          }}
        />
      </div>

      <div className="lp-scroll" style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        {editing ? (
          <textarea
            value={content}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            style={{
              width: '100%',
              height: '100%',
              minHeight: 400,
              fontFamily: 'var(--f-mono)',
              fontSize: 12.5,
              lineHeight: 1.6,
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-m)',
              padding: 12,
              background: 'var(--paper-2)',
              color: 'var(--ink-1)',
              resize: 'vertical',
            }}
          />
        ) : (
          <pre
            style={{
              margin: 0,
              fontFamily: detail.source === 'generated' ? 'var(--f-sans)' : 'var(--f-mono)',
              fontSize: 13,
              lineHeight: 1.65,
              color: 'var(--ink-2)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {content}
          </pre>
        )}
      </div>
    </>
  );
}

function EmptyHint({ message }: { message: string }) {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <p style={{ fontSize: 12.5, color: 'var(--ink-5)', textAlign: 'center', maxWidth: 360, margin: 0, lineHeight: 1.5 }}>
        {message}
      </p>
    </div>
  );
}

// ─── presentation layer ──────────────────────────────────────────────────────
//
// TODO(you): write `presentItems` below.
//
// This is the "domain UX vocabulary" layer. Given the raw API items, decide
// how each one looks in the list. The structural plumbing (fetching, click
// handling, edit/save/print/delete) is done — this function controls what
// the founder actually reads.
//
// Things you need to decide:
//
//   1. displayTitle — generated docs come in with names like the agent's
//      first guess ("Pitch Deck", "Investor One-Pager v3"). Do you trim,
//      Title-Case, prefix with doc_type? Uploaded files come in as raw
//      filenames ("Brand-Guide-FINAL-v2.pdf") — keep as-is or strip?
//
//   2. sourceBadge — "Generated" vs "Uploaded"? Or "Built" vs "Source"?
//      Or doc-type-as-badge for generated ("Deck", "One-pager") and
//      "File" for uploaded? Pick the founder's mental model.
//
//   3. typeBadge — optional secondary tag (e.g. file extension for uploads,
//      skill_id for generated). Return null to omit.
//
//   4. icon — pick from I.file / I.fileText / I.layers / I.image / I.book
//      / I.megaphone (see src/components/design/icons.tsx). Generated
//      pitch decks could use I.layers; one-pagers I.fileText; uploads I.file.
//
//   5. relativeDate — "Today" / "Yesterday" / "Mar 5" / ISO? Founders skim,
//      so short relative dates usually beat absolute ones.
//
//   6. Sort order — newest-first is default, but you might want to group
//      generated docs above uploads, or pin specific doc_types to the top.
//      Return them in the order you want rendered.
//
// Keep it ~30 lines. The return type is below — just fill in `presentItems`.

interface PresentedItem extends DataRoomItem {
  displayTitle: string;
  sourceBadge: string;
  typeBadge: string | null;
  icon: string;
  relativeDate: string;
}

function presentItems(items: DataRoomItem[]): PresentedItem[] {
  // TODO: implement. For now a stub so the page renders — replace this.
  return items.map((item) => ({
    ...item,
    displayTitle: item.title,
    sourceBadge: item.source,
    typeBadge: item.doc_type,
    icon: I.file,
    relativeDate: new Date(item.created_at).toLocaleDateString(),
  }));
}
