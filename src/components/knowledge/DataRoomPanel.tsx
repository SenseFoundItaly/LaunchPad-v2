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

import { useState, useMemo, useRef, useCallback } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Icon, I, IconBtn, Pill } from '@/components/design/primitives';
import { useT } from '@/components/providers/LocaleProvider';
import { openPrintPreview } from '@/lib/print-utils';

interface ExtractionCounts {
  applied: number;
  pending: number;
  rejected: number;
}

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
  /** null for generated docs; counts (possibly all zero) for uploads. */
  extraction: ExtractionCounts | null;
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
  const t = useT();
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
            {t('kb.data-room')}
          </span>
          {presented.length > 0 && (
            <span style={{ fontSize: 11, color: 'var(--ink-5)' }}>· {t('kb.items-count', { count: presented.length })}</span>
          )}
        </div>

        <InlineUpload
          projectId={projectId}
          onUploaded={() => {
            void qc.invalidateQueries({ queryKey: ['data-room', projectId] });
          }}
        />

        <ExtractionHelp />

        {isLoading ? (
          <EmptyHint message={t('common.loading')} />
        ) : presented.length === 0 ? (
          <EmptyHint message={t('kb.data-room-empty')} />
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: 'var(--ink-5)', flexWrap: 'wrap' }}>
                    <Pill kind={item.source === 'generated' ? 'info' : 'n'}>
                      {item.source === 'generated' ? t('kb.source-generated') : t('kb.source-uploaded')}
                    </Pill>
                    {item.indexBadge && (
                      <Pill kind={item.indexBadge.kind} dot={item.indexBadge.kind === 'ok'}>
                        {t(item.indexBadge.labelKey, item.indexBadge.count !== undefined ? { count: item.indexBadge.count } : undefined)}
                      </Pill>
                    )}
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
          <EmptyHint message={t('kb.select-item')} />
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
  const t = useT();
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

  if (isError) return <EmptyHint message={t('kb.document-unavailable')} />;
  if (isLoading || !detail) return <EmptyHint message={t('common.loading')} />;

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
            {detail.source === 'generated' ? (detail.doc_type ?? detail.kind) : t('kb.uploaded-file')}
            {' · '}
            {new Date(detail.created_at).toLocaleString()}
          </div>
        </div>
        {detail.editable && !editing && (
          <IconBtn d={I.edit} title={t('common.edit')} onClick={() => { setDraft(detail.content); setEditing(true); }} />
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
            {saveMutation.isPending ? t('kb.saving') : t('common.save')}
          </button>
        )}
        {editing && (
          <button
            onClick={() => { setEditing(false); setDraft(null); }}
            style={{ fontSize: 11, padding: '4px 10px', border: '1px solid var(--line)', background: 'transparent', borderRadius: 4, cursor: 'pointer' }}
          >
            {t('common.cancel')}
          </button>
        )}
        <IconBtn
          d={I.printer}
          title={t('kb.print-pdf')}
          onClick={() => openPrintPreview(detail.title, content)}
        />
        <IconBtn
          d={I.trash}
          title={t('common.delete')}
          onClick={() => {
            if (confirm(t('kb.delete-confirm', { title: detail.title }))) deleteMutation.mutate();
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

interface IndexBadge {
  /** i18n key for the badge label, resolved with `t` at render. */
  labelKey: string;
  /** Count interpolated into the label ({count}), when the key needs one. */
  count?: number;
  /** Pill `kind`: 'ok' = green (indexed), 'warn' = amber (pending),
   *  'n' = neutral (not indexed / N/A). */
  kind: 'ok' | 'warn' | 'n';
}

interface PresentedItem extends DataRoomItem {
  displayTitle: string;
  sourceBadge: string;
  typeBadge: string | null;
  icon: string;
  relativeDate: string;
  /** null = don't render a badge at all (e.g. generated deliverables). */
  indexBadge: IndexBadge | null;
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
    indexBadge: indexBadgeFor(item),
  }));
}

// ─── index-status badge policy ───────────────────────────────────────────────
//
// TODO(you): write `indexBadgeFor` below. ~8 lines.
//
// This is the founder-facing definition of "indexed". The backend hands us
// three counts per uploaded file:
//
//   extraction = { applied, pending, rejected }
//
//   applied  → entity proposals you APPROVED on the Review tab. These show up
//              in the Graph and are part of the live knowledge graph.
//   pending  → proposals the LLM made on upload, waiting for your review.
//   rejected → proposals you explicitly said no to.
//
// `extraction` is null for generated docs — return null in that case so no
// pill renders (deliverables don't have an "indexed" concept).
//
// You're picking a UX policy. Think about what's most useful at a glance:
//
//   • Treat "indexed" strictly: only `applied > 0` earns the green pill.
//     Pending proposals get a yellow "N pending" nudge to push to Review.
//     Zero entities = "Not indexed" — implies the file was uploaded but
//     extraction was skipped (legacy upload, or `?extract=1` was off).
//
//   • Or treat the existence of pending proposals as "indexed but unreviewed".
//
//   • You may also want to count applied + pending together and call it
//     "8 entities" with no review nuance — simpler, but hides the workflow.
//
// Return null to skip the pill entirely (e.g. if you don't want noise on
// files with zero extraction activity).
//
// Tradeoffs:
//   - A loud "Not indexed" badge on every legacy file may add visual noise
//     for projects with lots of pre-extraction uploads. Returning null in
//     that case keeps the list clean but hides that an action is possible.
//   - A green "Indexed · 5" badge with no count of pendings can hide work
//     the founder still has to do on Review.
//
// Pill kinds available: 'ok' (green), 'warn' (amber), 'n' (neutral grey).

function indexBadgeFor(item: DataRoomItem): IndexBadge | null {
  if (item.extraction === null) return null;
  const { applied, pending, rejected } = item.extraction;
  if (pending > 0) return { labelKey: 'kb.badge-review', count: pending, kind: 'warn' };
  if (applied > 0) return { labelKey: 'kb.badge-indexed', count: applied, kind: 'ok' };
  if (rejected > 0) return null;
  return { labelKey: 'kb.badge-not-indexed', kind: 'n' };
}

// ─── inline upload (compact dropzone scoped to this panel) ───────────────────
//
// Reuses the same POST /knowledge/upload?extract=1 endpoint as the Review tab,
// so behavior stays consistent across surfaces. The dropzone is intentionally
// minimal — no result list, no error inline (errors surface as an alert) —
// because the parent panel already shows the canonical list of files.

function InlineUpload({
  projectId,
  onUploaded,
}: {
  projectId: string;
  onUploaded: () => void;
}) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [isDragging, setIsDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  const send = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    setBusy(true);
    try {
      const form = new FormData();
      for (const f of list) form.append('file', f);
      const res = await fetch(`/api/projects/${projectId}/knowledge/upload?extract=1`, {
        method: 'POST',
        body: form,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        alert(body?.error ?? t('kb.upload-failed-http', { status: res.status }));
        return;
      }
      onUploaded();
    } finally {
      setBusy(false);
    }
  }, [projectId, onUploaded, t]);

  return (
    <div
      onDragEnter={(e) => { e.preventDefault(); dragDepth.current += 1; setIsDragging(true); }}
      onDragLeave={(e) => { e.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setIsDragging(false); }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        dragDepth.current = 0;
        setIsDragging(false);
        if (e.dataTransfer.files?.length) void send(e.dataTransfer.files);
      }}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click(); } }}
      style={{
        margin: '0 16px 8px',
        padding: '10px 12px',
        border: `1px dashed ${isDragging ? 'var(--accent)' : 'var(--line)'}`,
        background: isDragging ? 'var(--accent-wash, var(--paper-2))' : 'var(--paper-2)',
        borderRadius: 'var(--r-m)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        cursor: busy ? 'progress' : 'pointer',
        transition: 'background .12s, border-color .12s',
      }}
    >
      <Icon d={I.download} size={14} stroke={1.4} style={{ color: 'var(--ink-3)', transform: 'rotate(180deg)' }} />
      <div style={{ fontSize: 11.5, color: 'var(--ink-2)', lineHeight: 1.3 }}>
        {busy ? t('kb.uploading') : (
          <>
            <strong style={{ color: 'var(--ink)' }}>{t('kb.drop-files')}</strong>
            {' '}{t('kb.or-click-to-browse')}
          </>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        onChange={(e) => {
          const files = e.target.files;
          if (files) void send(files);
          e.target.value = '';
        }}
        style={{ display: 'none' }}
        accept=".md,.markdown,.txt,.csv,.tsv,.json,.yaml,.yml,.xml,.html,.htm,.log,.ini,.conf,.env,.ts,.tsx,.js,.jsx,.mjs,.cjs,.py,.rb,.go,.rs,.java,.sh,.bash,.zsh,.sql,.css,.scss,.toml,text/*,application/json"
      />
    </div>
  );
}

// ─── extraction help (one-line "what does indexing do?" affordance) ──────────
//
// Collapsed by default. Founders who already understand the pipeline don't
// need to be told twice; new users tap once to see what happens on upload.

function ExtractionHelp() {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div style={{ margin: '0 16px 12px', fontSize: 11, color: 'var(--ink-5)' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--ink-4)',
          cursor: 'pointer',
          padding: 0,
          fontSize: 11,
          textDecoration: 'underline',
          textUnderlineOffset: 2,
        }}
      >
        {open ? t('common.hide') : t('kb.what-is-indexing')}
      </button>
      {open && (
        <p style={{ margin: '6px 0 0', lineHeight: 1.5 }}>
          {t('kb.indexing-help-lead')}{' '}
          <em>{t('kb.indexing-help-pending')}</em> {t('kb.indexing-help-mid')}{' '}
          <strong>{t('kb.indexing-help-needs-review')}</strong> {t('kb.indexing-help-tail')}
        </p>
      )}
    </div>
  );
}
