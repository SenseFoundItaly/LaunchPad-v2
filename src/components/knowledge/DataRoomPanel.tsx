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
import type { MessageKey } from '@/lib/i18n/messages';
import { openPrintPreview, downloadMarkdownFile, downloadWordFile } from '@/lib/print-utils';
import ArtifactRenderer from '@/components/chat/artifacts/ArtifactRenderer';
import type { Artifact } from '@/types/artifacts';
import { isGenericTitle } from '@/lib/chat-artifact-meta';

/** Read-only handlers for the Data Room artifact re-render (no chat actions). */
const noop = () => {};

interface ExtractionCounts {
  applied: number;
  pending: number;
  rejected: number;
}

export interface DataRoomItem {
  id: string;
  source: 'uploaded' | 'generated' | 'chat_artifact';
  kind: string;
  title: string;
  doc_type: string | null;
  created_at: string;
  size_bytes: number | null;
  mime: string | null;
  has_editable_content: boolean;
  /** null for generated docs; counts (possibly all zero) for uploads. */
  extraction: ExtractionCounts | null;
  /** Digest state for uploads (latest digest event) — absent/null when never
   *  digested or not an upload. partial → offer re-digest; failed → offer retry. */
  digest?: { chunks: number; total_chunks: number; partial: boolean; failed: boolean } | null;
  /** Gap C: for a chat_artifact, the full artifact object to re-render inline. */
  payload?: unknown;
  sources?: unknown;
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
  // Gap C: which re-emitted chat-artifact groups are expanded (×N clicked).
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(new Set());
  // Long-doc integrity: id of the upload currently being re-digested (the
  // retro /digest run covers the tail the upload-time 2-chunk cap skipped).
  const [redigestingId, setRedigestingId] = useState<string | null>(null);

  const redigest = async (factId: string) => {
    if (redigestingId) return;
    setRedigestingId(factId);
    try {
      await fetch(`/api/projects/${projectId}/knowledge/digest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fact_id: factId }),
      });
      void qc.invalidateQueries({ queryKey: ['data-room', projectId] });
      window.dispatchEvent(new CustomEvent('lp-actions-changed', { detail: { projectId } }));
    } finally {
      setRedigestingId(null);
    }
  };

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
    () => presentItems(list?.items ?? [], expandedGroups),
    [list?.items, expandedGroups],
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
                    <Pill kind={item.source === 'generated' ? 'info' : item.source === 'chat_artifact' ? 'info' : 'n'}>
                      {item.source === 'generated' ? t('kb.source-generated') : item.source === 'chat_artifact' ? t('kb.source-analysis') : t('kb.source-uploaded')}
                    </Pill>
                    {item.indexBadge && (
                      <Pill kind={item.indexBadge.kind} dot={item.indexBadge.kind === 'ok'}>
                        {t(item.indexBadge.labelKey as MessageKey, item.indexBadge.count !== undefined ? { count: item.indexBadge.count } : undefined)}
                      </Pill>
                    )}
                    {item.digest && (item.digest.partial || item.digest.failed) && (
                      <span
                        role="button"
                        title={item.digest.failed ? t('kb.digest-retry-title') : t('kb.digest-partial-title')}
                        onClick={(e) => {
                          // Runs the retro digest over the FULL stored text —
                          // covers the tail the upload-time cap skipped (or
                          // retries a failed digest). Doesn't select the row.
                          e.stopPropagation();
                          void redigest(item.id);
                        }}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: redigestingId ? 'progress' : 'pointer' }}
                      >
                        <Pill kind="warn">
                          {redigestingId === item.id
                            ? t('kb.digest-running')
                            : item.digest.failed
                              ? t('kb.digest-failed')
                              : t('kb.digest-partial', { digested: item.digest.chunks, total: item.digest.total_chunks })}
                        </Pill>
                      </span>
                    )}
                    {item.typeBadge && (
                      <span className="lp-mono" style={{ background: 'var(--paper-2)', padding: '1px 5px', borderRadius: 3 }}>
                        {item.typeBadge}
                      </span>
                    )}
                    {item.versionBadge && (
                      <span
                        className="lp-mono"
                        title={item.chatGroupKey ? t('kb.toggle-versions') : undefined}
                        onClick={item.chatGroupKey ? (e) => {
                          // Gap C: ×N / vN badge toggles the re-emission group
                          // open/closed without selecting the row.
                          e.stopPropagation();
                          const key = item.chatGroupKey!;
                          setExpandedGroups((prev) => {
                            const next = new Set(prev);
                            if (next.has(key)) next.delete(key); else next.add(key);
                            return next;
                          });
                        } : undefined}
                        style={{ background: 'var(--paper-2)', padding: '1px 5px', borderRadius: 3, color: 'var(--ink-3)', cursor: item.chatGroupKey ? 'pointer' : undefined, textDecoration: item.chatGroupKey ? 'underline dotted' : undefined }}
                      >
                        {item.versionBadge}
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
        {(() => {
          if (!effectiveId) return <EmptyHint message={t('kb.select-item')} />;
          const selected = presented.find((p) => p.id === effectiveId);
          // Gap C: a chat artifact re-renders inline from its stored payload
          // (read-only) — no download/detail fetch, just the card as the founder
          // first saw it in chat.
          if (selected?.source === 'chat_artifact' && selected.payload) {
            return (
              <div style={{ padding: '18px 20px', overflow: 'auto' }}>
                {/* Gap C fix #3: chat artifacts are deletable like docs/uploads —
                    removes the retrievable card only, never the chat transcript. */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
                  <IconBtn
                    d={I.trash}
                    title={t('kb.delete-analysis')}
                    onClick={async () => {
                      if (!confirm(t('kb.delete-confirm', { title: selected.title }))) return;
                      const res = await fetch(`/api/projects/${projectId}/data-room/${selected.id}`, { method: 'DELETE' });
                      if (res.ok) {
                        setClickedId(null);
                        void qc.invalidateQueries({ queryKey: ['data-room', projectId] });
                      }
                    }}
                  />
                </div>
                <ArtifactRenderer
                  artifact={selected.payload as Artifact}
                  onAction={noop}
                  onEntityDiscovered={noop}
                  onWorkflowDiscovered={noop}
                />
              </div>
            );
          }
          return (
            <DataRoomDetailView
              projectId={projectId}
              itemId={effectiveId}
              onDeleted={() => {
                setClickedId(null);
                void qc.invalidateQueries({ queryKey: ['data-room', projectId] });
              }}
            />
          );
        })()}
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

  // Launch pipeline: html-preview deliverables are publishable to a real URL.
  // The click below IS the founder gate (same posture as Build Hub Generate).
  const { data: launchAssets } = useQuery<Array<{ id: string; url: string | null; source_artifact_id: string | null }>>({
    queryKey: ['launch-assets', projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/launch/assets`);
      const body = await res.json();
      return (body?.data ?? []) as Array<{ id: string; url: string | null; source_artifact_id: string | null }>;
    },
  });
  const publishMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/launch/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ artifact_id: itemId }),
      });
      const body = await res.json();
      if (!res.ok || body?.success === false) throw new Error(body?.error || `HTTP ${res.status}`);
      return body.data as { url: string };
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['launch-assets', projectId] }),
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
        {detail.source === 'generated' && detail.kind === 'html-preview' && (() => {
          const asset = (launchAssets ?? []).find((a) => a.source_artifact_id === itemId);
          const liveUrl = asset?.url && /^https?:\/\//.test(asset.url) ? asset.url : null;
          return (
            <>
              {liveUrl && (
                <a
                  href={liveUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="lp-mono"
                  style={{
                    fontSize: 10, fontWeight: 600, color: 'var(--moss)',
                    border: '1px solid var(--moss)', borderRadius: 999, padding: '2px 8px',
                    textDecoration: 'none', whiteSpace: 'nowrap',
                  }}
                >
                  {t('launch.live')}
                </a>
              )}
              <button
                onClick={() => publishMutation.mutate()}
                disabled={publishMutation.isPending}
                title={t('launch.publish-hint')}
                style={{
                  fontSize: 11, padding: '4px 10px', borderRadius: 4, cursor: 'pointer',
                  border: '1px solid var(--accent)',
                  background: asset ? 'transparent' : 'var(--accent)',
                  color: asset ? 'var(--accent-ink)' : 'white',
                }}
              >
                {publishMutation.isPending
                  ? t('launch.publishing')
                  : asset ? t('launch.republish') : t('launch.publish')}
              </button>
              {publishMutation.isError && (
                <span style={{ fontSize: 10, color: 'var(--clay)' }}>
                  {(publishMutation.error as Error)?.message?.slice(0, 80)}
                </span>
              )}
            </>
          );
        })()}
        {detail.source === 'generated' && (
          <>
            <IconBtn
              d={I.download}
              title={t('kb.download-md')}
              onClick={() => downloadMarkdownFile(detail.title, content)}
            />
            <IconBtn
              d={I.file}
              title={t('kb.download-doc')}
              onClick={() => downloadWordFile(detail.title, content)}
            />
          </>
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
  typeBadge: string | null;
  icon: string;
  relativeDate: string;
  /** null = don't render a badge at all (e.g. generated deliverables). */
  indexBadge: IndexBadge | null;
  /** "v2" when the same doc has been regenerated; null for one-offs/uploads.
   *  For chat artifacts: "×N" on the collapsed newest, "v1".."vN" when expanded. */
  versionBadge: string | null;
  /** Gap C: (kind, title) group key for a re-emitted chat artifact — set only
   *  when the group has >1 rows, so the ×N badge can toggle expansion. */
  chatGroupKey?: string;
}

/** Short, locale-aware date — founders skim; year only when it differs. */
function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

export function presentItems(
  items: DataRoomItem[],
  expandedChatGroups: ReadonlySet<string> = new Set(),
): PresentedItem[] {
  const versions = assignVersions(items);

  // Grouping fix (gap C): the agent re-emits the same analysis card
  // (comparison-table "Competitors", risk-matrix "Launch risks", …) across
  // MANY turns — incidental, not a deliberate regeneration. Left ungrouped they
  // pile up as duplicate rows. Collapse each (kind, title) to its NEWEST row and
  // badge the count (×N); clicking the badge expands the group to show older
  // rows badged v1..vN. Generated docs keep their full v1..vN history (those
  // ARE deliberate version history). Uploads are never grouped.
  //
  // Generic-title guard (gap C fix #5): a card that carried no real title got
  // the per-type fallback ("Comparison"); two DIFFERENT untitled comparisons
  // must not merge under it — generic-titled rows never group.
  const chatGroups = new Map<string, { rows: DataRoomItem[]; newest: DataRoomItem }>();
  for (const item of items) {
    if (item.source !== 'chat_artifact') continue;
    if (isGenericTitle(item.kind, item.title)) continue;
    const key = `${item.kind}::${item.title.trim().toLowerCase()}`;
    const g = chatGroups.get(key);
    if (!g) chatGroups.set(key, { rows: [item], newest: item });
    else {
      g.rows.push(item);
      if (item.created_at.localeCompare(g.newest.created_at) > 0) g.newest = item;
    }
  }
  // Per-row presentation decisions for grouped chat artifacts.
  const hiddenIds = new Set<string>();
  const chatBadges = new Map<string, string>();
  const chatKeys = new Map<string, string>();
  for (const [key, g] of chatGroups) {
    if (g.rows.length < 2) continue;
    const chrono = [...g.rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (expandedChatGroups.has(key)) {
      // Expanded: show every row, versioned v1..vN (oldest = v1); each keeps the
      // group key so any badge click collapses again.
      chrono.forEach((row, i) => {
        chatBadges.set(row.id, `v${i + 1}`);
        chatKeys.set(row.id, key);
      });
    } else {
      // Collapsed: newest only, with the ×N count as the expand affordance.
      for (const row of g.rows) if (row.id !== g.newest.id) hiddenIds.add(row.id);
      chatBadges.set(g.newest.id, `×${g.rows.length}`);
      chatKeys.set(g.newest.id, key);
    }
  }

  return items
    .filter((item) => !hiddenIds.has(item.id))
    .map((item) => {
      const uploaded = item.source === 'uploaded';
      const isChatArtifact = item.source === 'chat_artifact';
      const dot = item.title.lastIndexOf('.');
      const ext = uploaded && dot > 0 ? item.title.slice(dot + 1).toUpperCase() : null;
      return {
        ...item,
        displayTitle: item.title,
        // Uploads show their file extension; generated docs their doc type;
        // chat artifacts their card kind (comparison-table, risk-matrix, …).
        typeBadge: uploaded ? ext : (item.doc_type ?? item.kind),
        icon: uploaded ? I.file : isChatArtifact ? I.layers : /deck|pitch/i.test(item.doc_type ?? '') ? I.layers : I.book,
        relativeDate: shortDate(item.created_at),
        indexBadge: indexBadgeFor(item),
        // Chat artifacts: ×N collapsed / v1..vN expanded; generated docs: v1..vN.
        versionBadge: isChatArtifact ? (chatBadges.get(item.id) ?? null) : (versions.get(item.id) ?? null),
        chatGroupKey: chatKeys.get(item.id),
      };
    });
}

/**
 * Implicit versioning: every regeneration of a document is a fresh
 * build_artifacts INSERT, so rows sharing a doc type + (normalized) title ARE
 * the version history. Number them v1..vN by creation order, oldest = v1.
 * Singletons get no badge — "v1" on a doc with no siblings is just noise.
 */
function assignVersions(items: DataRoomItem[]): Map<string, string> {
  const groups = new Map<string, DataRoomItem[]>();
  for (const item of items) {
    if (item.source !== 'generated') continue;
    const key = `${item.doc_type ?? item.kind}::${item.title.trim().toLowerCase()}`;
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  const out = new Map<string, string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    [...group]
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .forEach((item, i) => out.set(item.id, `v${i + 1}`));
  }
  return out;
}

// ─── index-status badge policy ───────────────────────────────────────────────
//
// The founder-facing definition of "indexed", from the per-upload extraction
// counts {applied, pending, rejected}. Strict: only approved entities earn the
// green pill; pendings get an amber nudge to Review; all-rejected stays quiet.
// Generated deliverables (extraction === null) render no pill.

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
      const res = await fetch(`/api/projects/${projectId}/knowledge/upload?extract=1&digest=1`, {
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
        accept=".pdf,.docx,.md,.markdown,.txt,.csv,.tsv,.json,.yaml,.yml,.xml,.html,.htm,.log,.ini,.conf,.env,.ts,.tsx,.js,.jsx,.mjs,.cjs,.py,.rb,.go,.rs,.java,.sh,.bash,.zsh,.sql,.css,.scss,.toml,text/*,application/json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
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
