'use client';

/**
 * Drafts — list of draft_email, draft_linkedin_post, draft_linkedin_dm actions.
 *
 * Fetches from the existing /api/projects/{id}/actions endpoint and filters
 * client-side for draft action_types. Each draft card shows: title, action_type
 * chip, content preview, status pill, and action buttons (Edit, Send, Delete).
 */

import { use, useEffect, useState, useCallback } from 'react';
import { TopBar, NavRail } from '@/components/design/chrome';
import { useOpenActionCount } from '@/hooks/useOpenActionCount';
import {
  Pill,
  Panel,
  StatusBar,
  Icon,
  I,
  IconBtn,
  type PillKind,
} from '@/components/design/primitives';
import type { PendingAction, PendingActionStatus } from '@/types';

const DRAFT_TYPES = new Set(['draft_email', 'draft_linkedin_post', 'draft_linkedin_dm']);

const STATUS_PILL: Record<string, PillKind> = {
  pending: 'live',
  edited: 'info',
  applied: 'ok',
  sent: 'ok',
  rejected: 'n',
  failed: 'warn',
};

const TYPE_LABEL: Record<string, string> = {
  draft_email: 'Email',
  draft_linkedin_post: 'LinkedIn Post',
  draft_linkedin_dm: 'LinkedIn DM',
};

export default function DraftsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const { count: inboxBadge } = useOpenActionCount(projectId);
  const [drafts, setDrafts] = useState<PendingAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');

  const fetchDrafts = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/projects/${projectId}/actions?status=pending,edited,applied,sent`,
      );
      const body = await res.json();
      if (body.success && body.data?.actions) {
        setDrafts(
          (body.data.actions as PendingAction[]).filter((a) =>
            DRAFT_TYPES.has(a.action_type),
          ),
        );
      }
    } catch { /* partial data ok */ }
    finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { fetchDrafts(); }, [fetchDrafts]);

  async function transitionAction(actionId: string, transition: string, payload?: Record<string, unknown>) {
    await fetch(`/api/projects/${projectId}/actions/${actionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transition, ...payload }),
    });
    await fetchDrafts();
  }

  function startEdit(draft: PendingAction) {
    const body = (draft.edited_payload?.body ?? draft.payload?.body ?? '') as string;
    setEditBody(body);
    setEditingId(draft.id);
    setExpandedId(draft.id);
  }

  async function saveEdit(draft: PendingAction) {
    await transitionAction(draft.id, 'edit', {
      edited_payload: { ...draft.payload, body: editBody },
    });
    setEditingId(null);
  }

  return (
    <div className="lp-frame">
      <TopBar
        breadcrumb={['Project', 'Drafts']}
        right={
          <Pill kind="n">
            {drafts.length} draft{drafts.length !== 1 ? 's' : ''}
          </Pill>
        }
      />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <NavRail projectId={projectId} current="drafts" inboxBadge={inboxBadge} />

        <div
          className="lp-scroll"
          style={{ flex: 1, overflow: 'auto', padding: 24 }}
        >
          <div style={{ maxWidth: 720, margin: '0 auto' }}>
            {loading ? (
              <div style={{ textAlign: 'center', padding: 40, fontSize: 12, color: 'var(--ink-5)' }}>
                Loading drafts...
              </div>
            ) : drafts.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 60 }}>
                <Icon d={I.envelope} size={36} style={{ color: 'var(--ink-5)', opacity: 0.4 }} />
                <h2
                  className="lp-serif"
                  style={{ fontSize: 20, fontWeight: 400, letterSpacing: -0.3, margin: '12px 0 6px' }}
                >
                  No drafts yet
                </h2>
                <p style={{ fontSize: 12, color: 'var(--ink-4)', maxWidth: 340, margin: '0 auto' }}>
                  When the co-pilot drafts emails or LinkedIn posts, they&apos;ll appear here for your review.
                </p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {drafts.map((draft) => {
                  const isExpanded = expandedId === draft.id;
                  const isEditing = editingId === draft.id;
                  const body = (draft.edited_payload?.body ?? draft.payload?.body ?? '') as string;
                  const subject = (draft.payload?.subject ?? '') as string;

                  return (
                    <div key={draft.id} className="lp-card" style={{ overflow: 'hidden' }}>
                      {/* Header */}
                      <div
                        onClick={() => {
                          if (!isEditing) setExpandedId(isExpanded ? null : draft.id);
                        }}
                        style={{
                          padding: '12px 14px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          cursor: 'pointer',
                          transition: 'background .1s',
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--paper-2)'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                      >
                        <Pill kind="info">
                          {TYPE_LABEL[draft.action_type] || draft.action_type}
                        </Pill>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-2)' }}>
                            {draft.title}
                          </div>
                          {!isExpanded && body && (
                            <div
                              style={{
                                fontSize: 11,
                                color: 'var(--ink-5)',
                                marginTop: 2,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {body.slice(0, 120)}
                            </div>
                          )}
                        </div>
                        <Pill kind={STATUS_PILL[draft.status] || 'n'} dot>
                          {draft.status}
                        </Pill>
                        <span
                          className="lp-mono"
                          style={{ fontSize: 10, color: 'var(--ink-5)' }}
                        >
                          {new Date(draft.created_at).toLocaleDateString()}
                        </span>
                      </div>

                      {/* Expanded body */}
                      {isExpanded && (
                        <div style={{ borderTop: '1px solid var(--line)', padding: '12px 14px' }}>
                          {subject && (
                            <div style={{ fontSize: 11, color: 'var(--ink-4)', marginBottom: 8 }}>
                              <strong>Subject:</strong> {subject}
                            </div>
                          )}

                          {isEditing ? (
                            <textarea
                              value={editBody}
                              onChange={(e) => setEditBody(e.target.value)}
                              style={{
                                width: '100%',
                                minHeight: 200,
                                padding: 10,
                                fontSize: 12,
                                lineHeight: 1.6,
                                border: '1px solid var(--line-2)',
                                borderRadius: 'var(--r-m)',
                                background: 'var(--paper)',
                                color: 'var(--ink-2)',
                                fontFamily: 'var(--f-sans)',
                                resize: 'vertical',
                              }}
                            />
                          ) : (
                            <div
                              style={{
                                fontSize: 12,
                                lineHeight: 1.6,
                                color: 'var(--ink-2)',
                                whiteSpace: 'pre-wrap',
                                maxHeight: 300,
                                overflow: 'auto',
                                padding: 10,
                                background: 'var(--paper-2)',
                                borderRadius: 'var(--r-m)',
                              }}
                            >
                              {body || 'No content'}
                            </div>
                          )}

                          {/* Actions */}
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'flex-end',
                              gap: 8,
                              marginTop: 12,
                            }}
                          >
                            {isEditing ? (
                              <>
                                <button
                                  onClick={() => setEditingId(null)}
                                  style={btnGhost}
                                >
                                  Cancel
                                </button>
                                <button
                                  onClick={() => saveEdit(draft)}
                                  style={btnPrimary}
                                >
                                  <Icon d={I.check} size={12} /> Save
                                </button>
                              </>
                            ) : (
                              <>
                                {(draft.status === 'pending' || draft.status === 'edited') && (
                                  <>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); startEdit(draft); }}
                                      style={btnGhost}
                                    >
                                      <Icon d={I.edit} size={12} /> Edit
                                    </button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); transitionAction(draft.id, 'apply'); }}
                                      style={btnPrimary}
                                    >
                                      <Icon d={I.send} size={12} /> Send
                                    </button>
                                  </>
                                )}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (confirm('Delete this draft?')) {
                                      transitionAction(draft.id, 'reject');
                                    }
                                  }}
                                  style={btnDanger}
                                >
                                  <Icon d={I.trash} size={12} /> Delete
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
      <StatusBar
        heartbeatLabel={`drafts · ${drafts.length} items`}
        gateway="pi-agent · anthropic"
      />
    </div>
  );
}

const btnGhost: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '6px 12px',
  borderRadius: 'var(--r-m)',
  background: 'transparent',
  color: 'var(--ink-3)',
  border: '1px solid var(--line-2)',
  cursor: 'pointer',
  fontSize: 12,
  fontFamily: 'var(--f-sans)',
};

const btnPrimary: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '6px 12px',
  borderRadius: 'var(--r-m)',
  background: 'var(--moss)',
  color: 'var(--on-accent)',
  border: 'none',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 500,
  fontFamily: 'var(--f-sans)',
};

const btnDanger: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '6px 12px',
  borderRadius: 'var(--r-m)',
  background: 'transparent',
  color: 'var(--clay)',
  border: '1px solid var(--clay)',
  cursor: 'pointer',
  fontSize: 12,
  fontFamily: 'var(--f-sans)',
};
