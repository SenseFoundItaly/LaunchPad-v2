'use client';

/**
 * Knowledge Library — full-page view of all memory_facts, graph_nodes,
 * and tabular_reviews with tabs, search, type filters, and detail panel.
 *
 * Reuses KnowledgeReviewList for the review workflow (approve/reject/restore).
 */

import { use, useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface KnowledgeItem {
  id: string;
  type: 'fact' | 'graph_node' | 'tabular_review';
  title: string;
  detail: string | null;
  kind: string | null;
  reviewed_state: string;
  created_at: string;
}

interface UspFact {
  id: string;
  fact: string;
  kind: string;
}

type KnowledgeTab = 'pending' | 'applied' | 'rejected';

const TYPE_LABEL: Record<string, string> = {
  fact: 'Fact',
  graph_node: 'Entity',
  tabular_review: 'Review',
};

const TYPE_PILL: Record<string, PillKind> = {
  fact: 'info',
  graph_node: 'ok',
  tabular_review: 'warn',
};

const STATE_PILL: Record<string, PillKind> = {
  pending: 'live',
  applied: 'ok',
  rejected: 'n',
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function KnowledgePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const { count: inboxBadge } = useOpenActionCount(projectId);

  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<KnowledgeTab>('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // USP state
  const [usp, setUsp] = useState<UspFact | null>(null);
  const [uspEditing, setUspEditing] = useState(false);
  const [uspDraft, setUspDraft] = useState('');

  // Add knowledge form
  const [addOpen, setAddOpen] = useState(false);
  const [addTitle, setAddTitle] = useState('');
  const [addDetail, setAddDetail] = useState('');
  const [addKind, setAddKind] = useState('observation');

  // Tab data loaded flags
  const [loadedTabs, setLoadedTabs] = useState<Set<KnowledgeTab>>(new Set());

  const fetchTab = useCallback(async (tab: KnowledgeTab) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/knowledge?state=${tab}`);
      const json = await res.json();
      const data: KnowledgeItem[] = json.data?.items ?? [];
      setItems((prev) => {
        const otherItems = prev.filter((i) => i.reviewed_state !== tab);
        return [...otherItems, ...data];
      });
    } catch { /* partial data ok */ }
  }, [projectId]);

  const fetchUsp = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/knowledge?state=all`);
      const json = await res.json();
      const allItems: KnowledgeItem[] = json.data?.items ?? [];
      const uspItem = allItems.find((i) => i.kind === 'usp_statement');
      if (uspItem) {
        setUsp({ id: uspItem.id, fact: uspItem.detail || uspItem.title, kind: 'usp_statement' });
      }
    } catch { /* ok */ }
  }, [projectId]);

  useEffect(() => {
    Promise.all([fetchTab('pending'), fetchUsp()]).finally(() => {
      setLoading(false);
      setLoadedTabs(new Set(['pending']));
    });
  }, [fetchTab, fetchUsp]);

  function handleTabClick(tab: KnowledgeTab) {
    setActiveTab(tab);
    setSelectedId(null);
    if (!loadedTabs.has(tab)) {
      setLoadedTabs((prev) => new Set([...prev, tab]));
      void fetchTab(tab);
    }
  }

  async function patchItem(itemId: string, state: string) {
    await fetch(`/api/projects/${projectId}/knowledge/${itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
    });
  }

  async function handleApprove(id: string) {
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, reviewed_state: 'applied' } : i)),
    );
    await patchItem(id, 'applied');
  }

  async function handleReject(id: string) {
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, reviewed_state: 'rejected' } : i)),
    );
    await patchItem(id, 'rejected');
  }

  async function handleRestore(id: string) {
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, reviewed_state: 'pending' } : i)),
    );
    await patchItem(id, 'pending');
  }

  async function handleRemove(id: string) {
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, reviewed_state: 'rejected' } : i)),
    );
    await patchItem(id, 'rejected');
  }

  // USP save
  async function saveUsp() {
    const text = uspDraft.trim();
    if (!text) return;
    setUspEditing(false);
    try {
      await fetch(`/api/projects/${projectId}/knowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: text, kind: 'usp_statement' }),
      });
      setUsp({ id: usp?.id || 'new', fact: text, kind: 'usp_statement' });
      // Refresh to get actual ID
      await fetchUsp();
    } catch { /* ok */ }
  }

  // Add knowledge
  async function handleAddKnowledge() {
    if (!addTitle.trim()) return;
    try {
      await fetch(`/api/projects/${projectId}/knowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: addTitle.trim(), detail: addDetail.trim() || null, kind: addKind }),
      });
      setAddOpen(false);
      setAddTitle('');
      setAddDetail('');
      setAddKind('observation');
      // Refresh applied tab since manual facts go in as applied
      await fetchTab('applied');
      setLoadedTabs((prev) => new Set([...prev, 'applied']));
    } catch { /* ok */ }
  }

  // Filtering
  const tabItems = useMemo(() => {
    return items.filter((i) => i.reviewed_state === activeTab);
  }, [items, activeTab]);

  const filteredItems = useMemo(() => {
    let result = tabItems;
    if (typeFilter) {
      result = result.filter((i) => i.type === typeFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          (i.detail && i.detail.toLowerCase().includes(q)),
      );
    }
    return result;
  }, [tabItems, typeFilter, searchQuery]);

  const selected = selectedId ? items.find((i) => i.id === selectedId) : null;

  // Tab counts
  const counts = useMemo(() => {
    const c: Record<string, number> = { pending: 0, applied: 0, rejected: 0 };
    for (const i of items) c[i.reviewed_state] = (c[i.reviewed_state] || 0) + 1;
    return c;
  }, [items]);

  // Type counts for filter pills
  const typeCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const i of tabItems) c[i.type] = (c[i.type] || 0) + 1;
    return c;
  }, [tabItems]);

  return (
    <div className="lp-frame">
      <TopBar
        breadcrumb={['Project', 'Knowledge Library']}
        right={
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              onClick={() => setAddOpen(true)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '5px 10px',
                borderRadius: 'var(--r-m)',
                background: 'var(--moss)',
                color: 'var(--on-accent)',
                border: 'none',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 500,
                fontFamily: 'var(--f-sans)',
              }}
            >
              <Icon d={I.plus} size={12} /> Add knowledge
            </button>
            <Pill kind="n">
              {items.length} items
            </Pill>
          </span>
        }
      />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <NavRail projectId={projectId} current="knowledge" inboxBadge={inboxBadge} />

        {/* Main content */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* USP Banner */}
          <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--line)', background: 'var(--surface)' }}>
            {uspEditing ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <textarea
                  autoFocus
                  value={uspDraft}
                  onChange={(e) => setUspDraft(e.target.value)}
                  placeholder="Define your Unique Selling Proposition..."
                  style={{
                    flex: 1,
                    minHeight: 60,
                    padding: 10,
                    fontSize: 13,
                    lineHeight: 1.5,
                    border: '1px solid var(--line-2)',
                    borderRadius: 'var(--r-m)',
                    background: 'var(--paper)',
                    color: 'var(--ink)',
                    fontFamily: 'var(--f-sans)',
                    resize: 'vertical',
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveUsp(); }
                    if (e.key === 'Escape') setUspEditing(false);
                  }}
                />
                <button
                  onClick={saveUsp}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 'var(--r-m)',
                    background: 'var(--moss)',
                    color: 'var(--on-accent)',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 12,
                    fontWeight: 500,
                  }}
                >
                  Save
                </button>
              </div>
            ) : usp ? (
              <div
                onClick={() => { setUspDraft(usp.fact); setUspEditing(true); }}
                style={{ cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <Pill kind="ok" dot>USP</Pill>
                  <span style={{ fontSize: 10, color: 'var(--ink-5)' }}>click to edit</span>
                </div>
                <p style={{ fontSize: 14, color: 'var(--ink)', margin: 0, lineHeight: 1.5, fontWeight: 500 }}>
                  {usp.fact}
                </p>
              </div>
            ) : (
              <div
                onClick={() => { setUspDraft(''); setUspEditing(true); }}
                style={{
                  padding: '12px 16px',
                  border: '1px dashed var(--line-2)',
                  borderRadius: 'var(--r-m)',
                  cursor: 'pointer',
                  textAlign: 'center',
                }}
              >
                <Icon d={I.sparkles} size={16} style={{ color: 'var(--ink-5)', marginBottom: 4 }} />
                <div style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 500 }}>
                  Define your USP
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-5)', marginTop: 2 }}>
                  Click to write your Unique Selling Proposition
                </div>
              </div>
            )}
          </div>

          {/* Search + filter bar */}
          <div style={{ padding: '10px 24px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ position: 'relative', flex: 1, maxWidth: 300 }}>
              <Icon d={I.search} size={13} style={{ position: 'absolute', left: 8, top: 7, color: 'var(--ink-5)' }} />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search knowledge..."
                style={{
                  width: '100%',
                  height: 28,
                  paddingLeft: 28,
                  paddingRight: 8,
                  fontSize: 12,
                  border: '1px solid var(--line-2)',
                  borderRadius: 'var(--r-m)',
                  background: 'var(--paper)',
                  color: 'var(--ink)',
                  fontFamily: 'var(--f-sans)',
                  outline: 'none',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                onClick={() => setTypeFilter(null)}
                style={{
                  padding: '3px 10px',
                  fontSize: 11,
                  fontWeight: 500,
                  borderRadius: 'var(--r-m)',
                  border: '1px solid var(--line)',
                  background: typeFilter === null ? 'var(--paper-3)' : 'transparent',
                  color: typeFilter === null ? 'var(--ink)' : 'var(--ink-4)',
                  cursor: 'pointer',
                }}
              >
                All
              </button>
              {Object.entries(typeCounts).map(([type, count]) => (
                <button
                  key={type}
                  onClick={() => setTypeFilter(typeFilter === type ? null : type)}
                  style={{
                    padding: '3px 10px',
                    fontSize: 11,
                    fontWeight: 500,
                    borderRadius: 'var(--r-m)',
                    border: '1px solid var(--line)',
                    background: typeFilter === type ? 'var(--paper-3)' : 'transparent',
                    color: typeFilter === type ? 'var(--ink)' : 'var(--ink-4)',
                    cursor: 'pointer',
                  }}
                >
                  {TYPE_LABEL[type] || type} ({count})
                </button>
              ))}
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--line)', padding: '0 24px' }}>
            {(['pending', 'applied', 'rejected'] as KnowledgeTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => handleTabClick(tab)}
                style={{
                  padding: '8px 14px',
                  fontSize: 12,
                  fontWeight: activeTab === tab ? 600 : 400,
                  color: activeTab === tab ? 'var(--ink)' : 'var(--ink-4)',
                  borderBottom: activeTab === tab ? '2px solid var(--moss)' : '2px solid transparent',
                  background: 'none',
                  border: 'none',
                  borderBottomWidth: 2,
                  borderBottomStyle: 'solid',
                  borderBottomColor: activeTab === tab ? 'var(--moss)' : 'transparent',
                  cursor: 'pointer',
                  fontFamily: 'var(--f-sans)',
                }}
              >
                {tab === 'pending' ? 'Proposals' : tab === 'applied' ? 'In Context' : 'Rejected'}
                <span
                  className="lp-mono"
                  style={{ fontSize: 10, color: 'var(--ink-5)', marginLeft: 4 }}
                >
                  {counts[tab] || 0}
                </span>
              </button>
            ))}
          </div>

          {/* Item list + detail split */}
          <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
            {/* List */}
            <div
              className="lp-scroll"
              style={{ flex: 1, overflow: 'auto', padding: '12px 24px' }}
            >
              {loading ? (
                <div style={{ textAlign: 'center', padding: 40, fontSize: 12, color: 'var(--ink-5)' }}>
                  Loading...
                </div>
              ) : filteredItems.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40 }}>
                  <Icon d={I.book} size={32} style={{ color: 'var(--ink-5)', opacity: 0.4 }} />
                  <p style={{ fontSize: 12, color: 'var(--ink-5)', marginTop: 8 }}>
                    {searchQuery ? 'No items match your search.' : `No ${activeTab} items.`}
                  </p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {filteredItems.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => setSelectedId(selectedId === item.id ? null : item.id)}
                      className="lp-card"
                      style={{
                        padding: '10px 12px',
                        cursor: 'pointer',
                        background: selectedId === item.id ? 'var(--paper-2)' : undefined,
                        transition: 'background .1s',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Pill kind={TYPE_PILL[item.type] || 'n'}>
                          {TYPE_LABEL[item.type] || item.type}
                        </Pill>
                        <span
                          style={{
                            flex: 1,
                            fontSize: 12,
                            color: 'var(--ink-2)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {item.title}
                        </span>
                        {item.kind && item.kind !== 'review' && (
                          <span className="lp-mono" style={{ fontSize: 9, color: 'var(--ink-5)', textTransform: 'uppercase' }}>
                            {item.kind}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Detail panel */}
            <div
              style={{
                width: 340,
                flexShrink: 0,
                borderLeft: '1px solid var(--line)',
                background: 'var(--surface)',
                overflow: 'auto',
              }}
            >
              {selected ? (
                <div>
                  <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
                    <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                      <Pill kind={TYPE_PILL[selected.type] || 'n'}>
                        {TYPE_LABEL[selected.type] || selected.type}
                      </Pill>
                      <Pill kind={STATE_PILL[selected.reviewed_state] || 'n'} dot>
                        {selected.reviewed_state}
                      </Pill>
                    </div>
                    <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, letterSpacing: -0.2 }}>
                      {selected.title}
                    </h3>
                    <div className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)', marginTop: 4 }}>
                      {selected.kind && selected.kind !== 'review' ? `${selected.kind} · ` : ''}
                      {new Date(selected.created_at).toLocaleString()}
                    </div>
                  </div>
                  {selected.detail && (
                    <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
                      <p style={{ fontSize: 12.5, color: 'var(--ink-2)', margin: 0, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                        {selected.detail}
                      </p>
                    </div>
                  )}
                  <div style={{ padding: '14px 16px', display: 'flex', gap: 6 }}>
                    {selected.reviewed_state === 'pending' && (
                      <>
                        <button onClick={() => handleApprove(selected.id)} style={btnApprove}>
                          Approve
                        </button>
                        <button onClick={() => handleReject(selected.id)} style={btnRejectStyle}>
                          Reject
                        </button>
                      </>
                    )}
                    {selected.reviewed_state === 'applied' && (
                      <button onClick={() => handleRemove(selected.id)} style={btnRejectStyle}>
                        Remove
                      </button>
                    )}
                    {selected.reviewed_state === 'rejected' && (
                      <button onClick={() => handleRestore(selected.id)} style={btnApprove}>
                        Restore
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{ padding: 32, fontSize: 12, color: 'var(--ink-5)', textAlign: 'center' }}>
                  Select an item to see details.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Add knowledge modal */}
      {addOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 200,
          }}
          onClick={() => setAddOpen(false)}
        >
          <div
            className="lp-card"
            style={{ width: 440, padding: 20 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600, letterSpacing: -0.2 }}>
              Add Knowledge
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 11, color: 'var(--ink-4)', display: 'block', marginBottom: 4 }}>
                  Title
                </label>
                <input
                  autoFocus
                  value={addTitle}
                  onChange={(e) => setAddTitle(e.target.value)}
                  placeholder="e.g. Our main competitor raised Series A"
                  style={{
                    width: '100%',
                    height: 32,
                    padding: '0 10px',
                    fontSize: 13,
                    border: '1px solid var(--line-2)',
                    borderRadius: 'var(--r-m)',
                    background: 'var(--paper)',
                    color: 'var(--ink)',
                    fontFamily: 'var(--f-sans)',
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--ink-4)', display: 'block', marginBottom: 4 }}>
                  Detail (optional)
                </label>
                <textarea
                  value={addDetail}
                  onChange={(e) => setAddDetail(e.target.value)}
                  rows={3}
                  style={{
                    width: '100%',
                    padding: 10,
                    fontSize: 12,
                    border: '1px solid var(--line-2)',
                    borderRadius: 'var(--r-m)',
                    background: 'var(--paper)',
                    color: 'var(--ink)',
                    fontFamily: 'var(--f-sans)',
                    resize: 'vertical',
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--ink-4)', display: 'block', marginBottom: 4 }}>
                  Kind
                </label>
                <select
                  value={addKind}
                  onChange={(e) => setAddKind(e.target.value)}
                  style={{
                    height: 32,
                    padding: '0 10px',
                    fontSize: 12,
                    border: '1px solid var(--line-2)',
                    borderRadius: 'var(--r-m)',
                    background: 'var(--paper)',
                    color: 'var(--ink)',
                    fontFamily: 'var(--f-sans)',
                  }}
                >
                  <option value="observation">Observation</option>
                  <option value="hypothesis">Hypothesis</option>
                  <option value="note">Note</option>
                  <option value="competitor-intel">Competitor Intel</option>
                </select>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                <button onClick={() => setAddOpen(false)} style={btnGhost}>
                  Cancel
                </button>
                <button
                  onClick={handleAddKnowledge}
                  disabled={!addTitle.trim()}
                  style={{
                    ...btnApprove,
                    opacity: addTitle.trim() ? 1 : 0.5,
                  }}
                >
                  Add
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <StatusBar
        heartbeatLabel={`knowledge · ${items.length} items`}
        gateway="pi-agent · anthropic"
        ctxLabel={`${counts.pending || 0} pending`}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Local styles
// ---------------------------------------------------------------------------

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

const btnApprove: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '6px 14px',
  borderRadius: 'var(--r-m)',
  background: 'var(--moss)',
  color: 'var(--on-accent)',
  border: 'none',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 500,
  fontFamily: 'var(--f-sans)',
};

const btnRejectStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '6px 14px',
  borderRadius: 'var(--r-m)',
  background: 'transparent',
  color: 'var(--clay)',
  border: '1px solid var(--clay)',
  cursor: 'pointer',
  fontSize: 12,
  fontFamily: 'var(--f-sans)',
};
