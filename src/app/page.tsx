'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import api from '@/api';
import { TopBar } from '@/components/design/chrome';
import { Pill, StatusBar, Icon, I } from '@/components/design/primitives';
import { NODE_COLORS } from '@/types/graph';
import { watcherWeeklyLabel } from '@/lib/watcher-cost';
import { useT } from '@/components/providers/LocaleProvider';
import type { MessageKey } from '@/lib/i18n/messages';

// A watcher the upload extractor suggests from a founder's docs (opt-in).
type ProposedMonitor = { name: string; aim: string; cadence: 'daily' | 'weekly' };

// Lean-canvas fields the upload extractor proposes from a founder's docs.
type ProposedCanvas = {
  problem: string;
  solution: string;
  target_market: string;
  value_proposition: string;
  business_model: string;
  competitive_advantage: string;
};
const CANVAS_FIELD_LABELS: Array<{ key: keyof ProposedCanvas; labelKey: MessageKey }> = [
  { key: 'problem', labelKey: 'home.canvas-field-problem' },
  { key: 'solution', labelKey: 'home.canvas-field-solution' },
  { key: 'target_market', labelKey: 'home.canvas-field-target-market' },
  { key: 'value_proposition', labelKey: 'home.canvas-field-value-proposition' },
  { key: 'competitive_advantage', labelKey: 'home.canvas-field-competitive-edge' },
  { key: 'business_model', labelKey: 'home.canvas-field-business-model' },
];

interface DashboardProject {
  project_id: string;
  name: string;
  description: string;
  analyses_completed: number;
  total_analyses: number;
  weekly_alerts: number;
  created_at: string;
  /** 'owner' = the user's org owns the project; 'member' = shared with them. */
  access_kind?: 'owner' | 'member';
  /** Owner's email — useful for shared-tile tooltips. */
  owner_email?: string | null;
}

interface DashboardSignal {
  id: string;
  project_id: string;
  project_name: string;
  alert_type: string;
  alert_type_label: string;
  headline: string;
  body: string;
  severity: string;
  relevance_score: number;
  source_url?: string | null;
  created_at: string;
}

interface DashboardStats {
  total_projects: number;
  total_analyses_completed: number;
  total_alerts_this_week: number;
}

export default function HomePage() {
  const t = useT();
  const router = useRouter();
  const [projects, setProjects] = useState<DashboardProject[]>([]);
  const [signals, setSignals] = useState<DashboardSignal[]>([]);
  const [stats, setStats] = useState<DashboardStats>({
    total_projects: 0,
    total_analyses_completed: 0,
    total_alerts_this_week: 0,
  });
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  // 'scratch'   — empty project, founder builds canvas from chat
  // 'knowledge' — same + optional file uploads ingested into knowledge layer
  //               (POST /api/projects/{id}/knowledge/upload) before routing
  const [createMode, setCreateMode] = useState<'scratch' | 'knowledge'>('scratch');
  const [createFiles, setCreateFiles] = useState<File[]>([]);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  // Knowledge-populating flow: after a knowledge-mode upload, hold the project
  // we made + what the extraction surfaced, so we can show the founder the
  // artifacts pulled from their docs BEFORE routing into chat (instead of
  // silently dumping them in the graph).
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);
  const [extractResult, setExtractResult] = useState<{
    ingested: number;
    skipped: number;
    entities: Array<{ name: string; node_type: string; summary: string; filename: string; node_id?: string; validates?: string | null }>;
    canvas: ProposedCanvas | null;
    canvasValidates: Record<string, string>;
    spineSteps: number;
    monitors: ProposedMonitor[];
  } | null>(null);
  const [expandedSignals, setExpandedSignals] = useState<Set<string>>(new Set());
  const [showSignals, setShowSignals] = useState(false);
  const signalPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showSignals) return;
    function handleClick(e: MouseEvent) {
      if (signalPanelRef.current && !signalPanelRef.current.contains(e.target as Node)) {
        setShowSignals(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showSignals]);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/api/dashboard')
      .then(({ data }) => {
        if (cancelled) return;
        if (data.success && data.data) {
          setProjects(data.data.projects || []);
          setSignals(data.data.signals || []);
          setStats(
            data.data.stats || {
              total_projects: 0,
              total_analyses_completed: 0,
              total_alerts_this_week: 0,
            },
          );
        }
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    setCreateError(null);
    setUploadStatus(null);
    setExtractResult(null);
    try {
      const { data } = await api.post('/api/projects', {
        name: newName.trim(),
        description: newDesc.trim(),
      });
      if (!(data.success && data.data)) {
        setCreateError(data.error || t('home.error-create-failed'));
        setCreating(false);
        return;
      }
      const projectId = data.data.project_id || data.data.id;

      setCreatedProjectId(projectId);

      // Knowledge-mode: upload + extract BEFORE routing so the founder lands in
      // a project that already has its knowledge layer primed. On success we
      // PAUSE on a results view showing what was pulled from the docs (the
      // founder continues to chat from there); failures fall through to chat
      // with a non-fatal note.
      if (createMode === 'knowledge' && createFiles.length > 0) {
        try {
          setUploadStatus(
            createFiles.length > 1
              ? t('home.upload-status-reading-many', { count: createFiles.length })
              : t('home.upload-status-reading-one', { count: createFiles.length }),
          );
          const fd = new FormData();
          // Field name MUST be `file` (the route reads form.getAll('file')), and
          // ?extract=1 turns on entity extraction → pending graph nodes.
          for (const f of createFiles) fd.append('file', f, f.name);
          const res = await fetch(`/api/projects/${projectId}/knowledge/upload?extract=1`, {
            method: 'POST',
            body: fd,
          });
          const body = await res.json().catch(() => null);
          if (res.ok && body?.success && body.data) {
            const d = body.data as {
              ingested?: number;
              skipped?: number;
              extracted_entities?: Array<{ name: string; node_type: string; summary: string; filename: string; node_id?: string; validates?: string | null }>;
              proposed_canvas?: ProposedCanvas | null;
              canvas_validates?: Record<string, string>;
              spine_steps?: number;
              proposed_monitors?: ProposedMonitor[];
            };
            setExtractResult({
              ingested: d.ingested ?? 0,
              skipped: d.skipped ?? 0,
              entities: Array.isArray(d.extracted_entities) ? d.extracted_entities : [],
              canvas: d.proposed_canvas ?? null,
              canvasValidates: d.canvas_validates ?? {},
              spineSteps: d.spine_steps ?? 0,
              monitors: Array.isArray(d.proposed_monitors) ? d.proposed_monitors : [],
            });
            setCreating(false);
            return; // show the results view; route to chat on "Continue"
          }
          // Upload failed — surface it instead of silently routing into an
          // empty project (that silence masked a real 415 CSRF-guard bug).
          setCreateError(
            t('home.error-upload-failed', {
              reason: body?.error || `HTTP ${res.status}`,
              name: newName.trim(),
            }),
          );
          setCreating(false);
          return;
        } catch (err) {
          setCreateError(
            t('home.error-upload-errored', {
              reason: (err as Error).message,
              name: newName.trim(),
            }),
          );
          setCreating(false);
          return;
        }
      }

      router.push(`/project/${projectId}/chat`);
    } catch (err) {
      setCreateError((err as Error).message || t('home.error-network'));
    }
    setCreating(false);
  }

  function toggleSignal(id: string) {
    setExpandedSignals((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function getOneLiner(headline: string): string {
    if (headline.length > 120) return headline.slice(0, 120).trimEnd() + '…';
    return headline;
  }

  function relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t('home.time-now');
    if (mins < 60) return t('home.time-minutes-ago', { count: mins });
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return t('home.time-hours-ago', { count: hrs });
    const days = Math.floor(hrs / 24);
    return t('home.time-days-ago', { count: days });
  }

  const severityKind = (s: string): 'ok' | 'warn' | 'live' | 'n' =>
    s === 'critical' ? 'live' : s === 'high' ? 'warn' : s === 'low' ? 'ok' : 'n';

  return (
    <div className="lp-frame">
      <TopBar
        breadcrumb={[t('home.breadcrumb')]}
        right={
          <span className="lp-mono" style={{ fontSize: 10 }}>
            {stats.total_projects !== 1
              ? t('home.project-count-many', { count: stats.total_projects })
              : t('home.project-count-one', { count: stats.total_projects })}
          </span>
        }
      />

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Left projects rail */}
        <div
          style={{
            width: 200,
            flexShrink: 0,
            borderRight: '1px solid var(--line)',
            background: 'var(--paper-2)',
            display: 'flex',
            flexDirection: 'column',
            padding: '12px 0',
            gap: 2,
          }}
        >
          <div
            style={{
              padding: '0 12px 8px',
              fontSize: 10,
              color: 'var(--ink-5)',
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              fontFamily: 'var(--f-mono)',
            }}
          >
            {t('home.projects-heading')}
          </div>

          <div style={{ flex: 1, overflow: 'auto' }}>
            {projects.map((p) => (
              <Link
                key={p.project_id}
                href={`/project/${p.project_id}/chat`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '7px 12px',
                  fontSize: 12.5,
                  color: 'var(--ink-2)',
                  textDecoration: 'none',
                  borderRadius: 0,
                  transition: 'background .1s',
                }}
                className="lp-rail-item"
              >
                <span
                  style={{
                    width: 22,
                    height: 22,
                    flexShrink: 0,
                    borderRadius: 6,
                    background: 'var(--surface)',
                    border: '1px solid var(--line)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 10,
                    fontWeight: 700,
                    fontFamily: 'var(--f-mono)',
                    color: 'var(--ink-3)',
                  }}
                >
                  {p.name.slice(0, 2).toUpperCase()}
                </span>
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {p.name}
                </span>
                {p.access_kind === 'member' && (
                  <span
                    title={p.owner_email ? t('home.shared-by', { email: p.owner_email }) : t('home.shared-with-you')}
                    className="lp-mono"
                    style={{
                      fontSize: 9,
                      color: 'var(--accent-ink)',
                      background: 'var(--accent-wash)',
                      padding: '1px 5px',
                      borderRadius: 999,
                      letterSpacing: 0.3,
                      textTransform: 'uppercase',
                    }}
                  >
                    {t('home.shared')}
                  </span>
                )}
                {p.weekly_alerts > 0 && (
                  <span
                    style={{
                      fontSize: 9,
                      fontFamily: 'var(--f-mono)',
                      color: 'var(--clay)',
                      background: 'var(--accent-wash)',
                      padding: '1px 4px',
                      borderRadius: 4,
                    }}
                  >
                    {p.weekly_alerts}
                  </span>
                )}
              </Link>
            ))}
          </div>

          <div style={{ padding: '8px 8px 0' }}>
            <button
              onClick={() => setShowCreate(true)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 8px',
                background: 'transparent',
                border: '1px dashed var(--line-2)',
                borderRadius: 'var(--r-m)',
                color: 'var(--ink-4)',
                fontSize: 12,
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'border-color .12s, color .12s',
              }}
            >
              <Icon d={I.plus} size={12} />
              {t('home.new-project')}
            </button>
          </div>
        </div>

        {/* Main content */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            background: 'var(--paper)',
          }}
        >
          {/* Content header */}
          <div
            style={{
              padding: '16px 24px 14px',
              borderBottom: '1px solid var(--line)',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <h1
              className="lp-serif"
              style={{ fontSize: 22, fontWeight: 400, letterSpacing: -0.3, margin: 0 }}
            >
              {t('home.workspace')}
            </h1>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>
              {t('home.analyses-completed', { count: stats.total_analyses_completed })}
            </span>
            <div ref={signalPanelRef} style={{ position: 'relative' }}>
              <button
                onClick={() => setShowSignals((v) => !v)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '3px 8px',
                  fontSize: 11,
                  fontFamily: 'var(--f-mono)',
                  color: signals.length > 0 ? 'var(--clay)' : 'var(--ink-4)',
                  background: signals.length > 0 ? 'var(--accent-wash)' : 'var(--surface)',
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--r-m)',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                {stats.total_alerts_this_week !== 1
                  ? t('home.signal-count-many', { count: stats.total_alerts_this_week })
                  : t('home.signal-count-one', { count: stats.total_alerts_this_week })}
              </button>

              {showSignals && signals.length > 0 && (
                <div
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 6px)',
                    right: 0,
                    width: 480,
                    maxHeight: 420,
                    overflowY: 'auto',
                    background: 'var(--surface)',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--r-m)',
                    boxShadow: '0 8px 24px rgba(0,0,0,.12)',
                    zIndex: 100,
                  }}
                >
                  <div
                    style={{
                      padding: '8px 12px',
                      fontSize: 10,
                      color: 'var(--ink-5)',
                      textTransform: 'uppercase',
                      letterSpacing: 0.5,
                      fontFamily: 'var(--f-mono)',
                      borderBottom: '1px solid var(--line)',
                    }}
                  >
                    {t('home.recent-signals')}
                  </div>
                  {signals.map((s, i) => {
                    const expanded = expandedSignals.has(s.id);
                    const hasDetail = s.body.length > 0;
                    return (
                      <div key={s.id}>
                        <div
                          onClick={() => hasDetail && toggleSignal(s.id)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '8px 12px',
                            borderBottom:
                              i < signals.length - 1 || expanded
                                ? '1px solid var(--line)'
                                : 'none',
                            cursor: hasDetail ? 'pointer' : 'default',
                            transition: 'background .1s',
                          }}
                          className={hasDetail ? 'lp-rail-item' : undefined}
                        >
                          <Pill kind={severityKind(s.severity)}>{s.severity}</Pill>
                          <Pill kind="n">{s.alert_type_label}</Pill>
                          <span
                            style={{
                              fontSize: 11,
                              color: 'var(--ink-4)',
                              flexShrink: 0,
                              fontFamily: 'var(--f-mono)',
                            }}
                          >
                            {s.project_name}
                          </span>
                          <span
                            style={{
                              flex: 1,
                              minWidth: 0,
                              fontSize: 12.5,
                              color: 'var(--ink-2)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {getOneLiner(s.headline)}
                            {s.source_url && (
                              <span style={{ fontSize: 10, color: 'var(--ink-5)', marginLeft: 6 }}>
                                {safeHost(s.source_url)} ↗
                              </span>
                            )}
                          </span>
                          <span
                            style={{
                              fontSize: 10,
                              color: 'var(--ink-5)',
                              flexShrink: 0,
                              fontFamily: 'var(--f-mono)',
                            }}
                          >
                            {relativeTime(s.created_at)}
                          </span>
                          {hasDetail && (
                            <span
                              style={{
                                fontSize: 10,
                                color: 'var(--ink-5)',
                                flexShrink: 0,
                                transition: 'transform .15s',
                                transform: expanded ? 'rotate(90deg)' : 'none',
                                display: 'inline-block',
                              }}
                            >
                              ▸
                            </span>
                          )}
                        </div>
                        {expanded && (
                          <div
                            style={{
                              padding: '10px 12px 12px',
                              borderBottom:
                                i < signals.length - 1
                                  ? '1px solid var(--line)'
                                  : 'none',
                              fontSize: 12,
                              color: 'var(--ink-3)',
                              lineHeight: 1.5,
                              maxHeight: 300,
                              overflowY: 'auto',
                              background: 'var(--paper-2)',
                            }}
                          >
                            {s.source_url && (
                              <a
                                href={s.source_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4,
                                  fontSize: 11,
                                  color: 'var(--accent-ink)',
                                  marginBottom: 8,
                                  textDecoration: 'none',
                                }}
                              >
                                <Icon d={I.globe} size={10} />
                                {safeHost(s.source_url)} ↗
                              </a>
                            )}
                            <div className="lp-prose">
                              <ReactMarkdown
                                components={{
                                  a: ({ children, href, ...props }) => (
                                    <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>
                                  ),
                                }}
                              >
                                {s.body}
                              </ReactMarkdown>
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

          <div className="lp-scroll" style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
            {loading ? (
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--ink-5)',
                  padding: 40,
                  textAlign: 'center',
                }}
              >
                {t('common.loading')}
              </div>
            ) : (
              <>
                {/* Create form */}
                {showCreate && (
                  <div
                    className="lp-card"
                    style={{ padding: 16, marginBottom: 20 }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10 }}>
                      {t('home.new-project')}
                    </div>

                    {extractResult ? (
                      <ExtractedKnowledgeView
                        result={extractResult}
                        projectId={createdProjectId}
                        onContinue={() => {
                          if (createdProjectId) router.push(`/project/${createdProjectId}/chat`);
                        }}
                      />
                    ) : creating && createMode === 'knowledge' && createFiles.length > 0 ? (
                      <ExtractingView files={createFiles} status={uploadStatus} />
                    ) : (
                    <>
                    {/* Mode toggle — scratch vs. existing knowledge */}
                    <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                      {([
                        { id: 'scratch', labelKey: 'home.mode-scratch-label', descKey: 'home.mode-scratch-desc' },
                        { id: 'knowledge', labelKey: 'home.mode-knowledge-label', descKey: 'home.mode-knowledge-desc' },
                      ] as const).map((opt) => {
                        const selected = createMode === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setCreateMode(opt.id)}
                            style={{
                              flex: 1,
                              textAlign: 'left',
                              padding: '10px 12px',
                              background: selected ? 'var(--surface)' : 'var(--paper)',
                              border: `1px solid ${selected ? 'var(--ink)' : 'var(--line-2)'}`,
                              borderRadius: 'var(--r-m)',
                              cursor: 'pointer',
                              color: 'var(--ink-2)',
                              fontFamily: 'inherit',
                              boxShadow: selected ? 'inset 0 0 0 1px var(--ink)' : 'none',
                            }}
                          >
                            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>
                              {t(opt.labelKey)}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 2 }}>
                              {t(opt.descKey)}
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        autoFocus
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder={t('home.project-name-placeholder')}
                        onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                        style={{
                          flex: 1,
                          padding: '7px 10px',
                          background: 'var(--paper)',
                          border: '1px solid var(--line-2)',
                          borderRadius: 'var(--r-m)',
                          fontSize: 13,
                          color: 'var(--ink-2)',
                          fontFamily: 'inherit',
                          outline: 'none',
                        }}
                      />
                      <input
                        value={newDesc}
                        onChange={(e) => setNewDesc(e.target.value)}
                        placeholder={t('home.description-placeholder')}
                        onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                        style={{
                          flex: 1,
                          padding: '7px 10px',
                          background: 'var(--paper)',
                          border: '1px solid var(--line-2)',
                          borderRadius: 'var(--r-m)',
                          fontSize: 13,
                          color: 'var(--ink-2)',
                          fontFamily: 'inherit',
                          outline: 'none',
                        }}
                      />
                      <button
                        onClick={handleCreate}
                        disabled={creating || !newName.trim()}
                        style={{
                          padding: '7px 14px',
                          background: 'var(--ink)',
                          color: 'var(--paper)',
                          border: 'none',
                          borderRadius: 'var(--r-m)',
                          fontSize: 12,
                          fontWeight: 500,
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                          opacity: creating || !newName.trim() ? 0.5 : 1,
                        }}
                      >
                        {creating ? (uploadStatus ? t('home.uploading') : t('home.creating')) : t('home.create')}
                      </button>
                      <button
                        onClick={() => {
                          setShowCreate(false);
                          setNewName('');
                          setNewDesc('');
                          setCreateError(null);
                          setCreateMode('scratch');
                          setCreateFiles([]);
                          setUploadStatus(null);
                          setExtractResult(null);
                          setCreatedProjectId(null);
                        }}
                        style={{
                          padding: '7px 10px',
                          background: 'transparent',
                          color: 'var(--ink-4)',
                          border: '1px solid var(--line)',
                          borderRadius: 'var(--r-m)',
                          fontSize: 12,
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                        }}
                      >
                        {t('common.cancel')}
                      </button>
                    </div>

                    {/* Knowledge-mode file picker */}
                    {createMode === 'knowledge' && (
                      <div
                        style={{
                          marginTop: 12,
                          padding: 12,
                          background: 'var(--paper)',
                          border: '1px dashed var(--line-2)',
                          borderRadius: 'var(--r-m)',
                        }}
                      >
                        <label
                          htmlFor="create-knowledge-files"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 8,
                            cursor: 'pointer',
                          }}
                        >
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)' }}>
                              {t('home.upload-documents')}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 2 }}>
                              {t('home.upload-documents-desc')}
                            </div>
                          </div>
                          <span
                            style={{
                              padding: '6px 10px',
                              background: 'var(--surface)',
                              border: '1px solid var(--line-2)',
                              borderRadius: 'var(--r-m)',
                              fontSize: 11,
                              color: 'var(--ink-2)',
                              fontFamily: 'inherit',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {t('home.choose-files')}
                          </span>
                        </label>
                        <input
                          id="create-knowledge-files"
                          type="file"
                          multiple
                          accept=".pdf,.docx,.txt,.md,.markdown,.rst,.csv,.tsv,.json,.yaml,.yml,.xml,.html,.htm,.log,.ini,.conf,.env,.ts,.tsx,.js,.jsx,.mjs,.cjs,.py,.rb,.go,.rs,.java,.sh,.bash,.zsh,.sql,.css,.scss,.toml,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/*,application/json,application/xml,application/yaml,application/x-yaml,application/javascript,application/typescript,application/sql,application/csv"
                          onChange={(e) => {
                            const list = Array.from(e.target.files || []).slice(0, 10);
                            setCreateFiles(list);
                          }}
                          style={{ display: 'none' }}
                        />
                        {createFiles.length > 0 && (
                          <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {createFiles.map((f, i) => (
                              <span
                                key={`${f.name}-${i}`}
                                title={`${(f.size / 1024).toFixed(1)} KB`}
                                style={{
                                  padding: '4px 8px',
                                  background: 'var(--surface)',
                                  border: '1px solid var(--line)',
                                  borderRadius: 'var(--r-s, 6px)',
                                  fontSize: 11,
                                  color: 'var(--ink-2)',
                                  fontFamily: 'var(--f-mono)',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 6,
                                }}
                              >
                                {f.name}
                                <button
                                  type="button"
                                  onClick={() =>
                                    setCreateFiles(createFiles.filter((_, idx) => idx !== i))
                                  }
                                  style={{
                                    background: 'transparent',
                                    border: 'none',
                                    color: 'var(--ink-5)',
                                    cursor: 'pointer',
                                    fontSize: 11,
                                    padding: 0,
                                    lineHeight: 1,
                                  }}
                                  aria-label={t('home.remove-file', { name: f.name })}
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                        {uploadStatus && (
                          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--ink-4)' }}>
                            {uploadStatus}
                          </div>
                        )}
                      </div>
                    )}
                    {createError && (
                      <div style={{ marginTop: 8, fontSize: 12, color: 'var(--clay, #c0392b)' }}>
                        {createError}
                      </div>
                    )}
                    </>
                    )}
                  </div>
                )}

                {/* Projects grid */}
                {projects.length > 0 ? (
                  <div>
                    <div
                      style={{
                        fontSize: 10,
                        color: 'var(--ink-5)',
                        textTransform: 'uppercase',
                        letterSpacing: 0.5,
                        fontFamily: 'var(--f-mono)',
                        marginBottom: 10,
                      }}
                    >
                      {t('home.projects-heading')}
                    </div>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                        gap: 12,
                      }}
                    >
                      {projects.map((p) => (
                        <Link
                          key={p.project_id}
                          href={`/project/${p.project_id}/chat`}
                          style={{ textDecoration: 'none' }}
                        >
                          <div
                            className="lp-card"
                            style={{
                              padding: '14px 16px',
                              cursor: 'pointer',
                              transition: 'box-shadow .15s',
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: 10,
                                marginBottom: 8,
                              }}
                            >
                              <span
                                style={{
                                  width: 28,
                                  height: 28,
                                  flexShrink: 0,
                                  borderRadius: 7,
                                  background: 'var(--surface)',
                                  border: '1px solid var(--line)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: 11,
                                  fontWeight: 700,
                                  fontFamily: 'var(--f-mono)',
                                  color: 'var(--ink-3)',
                                }}
                              >
                                {p.name.slice(0, 2).toUpperCase()}
                              </span>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div
                                  style={{
                                    fontSize: 13,
                                    fontWeight: 600,
                                    color: 'var(--ink)',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6,
                                  }}
                                >
                                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {p.name}
                                  </span>
                                  {p.access_kind === 'member' && (
                                    <span
                                      title={p.owner_email ? t('home.shared-by', { email: p.owner_email }) : t('home.shared-with-you')}
                                      className="lp-mono"
                                      style={{
                                        fontSize: 9,
                                        color: 'var(--accent-ink)',
                                        background: 'var(--accent-wash)',
                                        padding: '1px 6px',
                                        borderRadius: 999,
                                        letterSpacing: 0.3,
                                        textTransform: 'uppercase',
                                        flexShrink: 0,
                                      }}
                                    >
                                      {t('home.shared')}
                                    </span>
                                  )}
                                </div>
                                {p.description && (
                                  <div
                                    style={{
                                      fontSize: 11.5,
                                      color: 'var(--ink-4)',
                                      marginTop: 2,
                                      lineHeight: 1.4,
                                      overflow: 'hidden',
                                      display: '-webkit-box',
                                      WebkitLineClamp: 2,
                                      WebkitBoxOrient: 'vertical',
                                    }}
                                  >
                                    {p.description}
                                  </div>
                                )}
                              </div>
                              {p.weekly_alerts > 0 && (
                                <Pill kind="warn">{p.weekly_alerts}</Pill>
                              )}
                            </div>
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                fontSize: 11,
                                color: 'var(--ink-5)',
                                fontFamily: 'var(--f-mono)',
                              }}
                            >
                              <span>
                                {t('home.percent-validated', { percent: Math.round((p.analyses_completed / p.total_analyses) * 100) })}
                              </span>
                              <span>·</span>
                              <span>
                                {new Date(p.created_at).toLocaleDateString('en', {
                                  month: 'short',
                                  day: 'numeric',
                                })}
                              </span>
                            </div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                ) : (
                  !showCreate && (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: 60,
                        gap: 12,
                        color: 'var(--ink-4)',
                        textAlign: 'center',
                      }}
                    >
                      <Icon d={I.layers} size={32} style={{ opacity: 0.4 }} />
                      <h3
                        className="lp-serif"
                        style={{ fontSize: 20, fontWeight: 400, margin: 0, color: 'var(--ink-3)' }}
                      >
                        {t('home.empty-title')}
                      </h3>
                      <p style={{ margin: 0, maxWidth: 360, fontSize: 13, lineHeight: 1.55 }}>
                        {t('home.empty-desc')}
                      </p>
                      <button
                        onClick={() => setShowCreate(true)}
                        style={{
                          marginTop: 4,
                          padding: '8px 16px',
                          background: 'var(--ink)',
                          color: 'var(--paper)',
                          border: 'none',
                          borderRadius: 'var(--r-m)',
                          fontSize: 13,
                          fontWeight: 500,
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                        }}
                      >
                        {t('home.create-project')}
                      </button>
                    </div>
                  )
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <StatusBar
        heartbeatLabel={t('home.status-heartbeat-idle')}
        gateway="pi-agent · anthropic"
        ctxLabel={t('home.status-projects', { count: stats.total_projects })}
        budget={t('home.status-signals', { count: stats.total_alerts_this_week })}
      />
    </div>
  );
}

function safeHost(url: string): string {
  try { return new URL(url).hostname; } catch { return url.slice(0, 40); }
}

// ─── Knowledge-populating flow (create-from-documents) ───────────────────────

/** Shown while the upload is parsing docs + extracting entities. */
function ExtractingView({ files, status }: { files: File[]; status: string | null }) {
  const t = useT();
  return (
    <div style={{ padding: '6px 0 4px' }}>
      <div className="lp-pulse" style={{ fontSize: 13, color: 'var(--ink-2)', marginBottom: 8 }}>
        {status || t('home.extracting-reading')}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {files.map((f, i) => (
          <span key={`${f.name}-${i}`} className="lp-chip" style={{ background: 'var(--paper-2)', color: 'var(--ink-4)' }}>
            {f.name}
          </span>
        ))}
      </div>
      <div style={{ fontSize: 11, color: 'var(--ink-5)', marginTop: 10 }}>
        {t('home.extracting-parsing')}
      </div>
    </div>
  );
}

/** Shown after extraction: the canvas drafted from the docs (apply → Stage 1)
 *  + the entities pulled into the graph, then continue. */
function ExtractedKnowledgeView({
  result,
  projectId,
  onContinue,
}: {
  result: { ingested: number; skipped: number; entities: Array<{ name: string; node_type: string; summary: string; filename: string; node_id?: string; validates?: string | null }>; canvas: ProposedCanvas | null; canvasValidates: Record<string, string>; spineSteps: number; monitors: ProposedMonitor[] };
  projectId: string | null;
  onContinue: () => void;
}) {
  const t = useT();
  const { ingested, skipped, entities, canvas, canvasValidates, spineSteps, monitors } = result;
  const [applying, setApplying] = useState(false);
  // Watchers default UNCHECKED — they carry recurring weekly cost, so opting
  // into ongoing spend is a deliberate choice, not a default (approve-first).
  const [checkedWatchers, setCheckedWatchers] = useState<Set<number>>(() => new Set());

  const canvasFields = canvas
    ? CANVAS_FIELD_LABELS.filter((f) => canvas[f.key]?.trim())
    : [];

  // Three separate cost models — never blended into one number:
  //   canvas = free · entities = flat 2 each (charged now) · watchers = weekly.
  const APPLY_COST = 2; // mirrors KNOWLEDGE_APPLY_CREDITS (kept inline so the
  // client bundle doesn't import @/lib/credits → postgres.js). Server debit is
  // authoritative; this is display-only.
  const applicableIds = entities.map((e) => e.node_id).filter((x): x is string => !!x);
  const applyCredits = applicableIds.length * APPLY_COST;
  const checkedCount = checkedWatchers.size;
  // Applying also generates a personalized AI brief (one Sonnet call, metered).
  // Estimate shown on the button; actual cost is metered server-side.
  const BRIEF_CREDITS_EST = 3;
  const upfrontCredits = applyCredits + BRIEF_CREDITS_EST;

  function toggleWatcher(i: number) {
    setCheckedWatchers((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }

  // ONE commit: canvas → entity batch-apply → checked watchers → into chat.
  // Every sub-action is best-effort/non-fatal — the founder always routes on.
  async function applyAndContinue() {
    if (!projectId) { onContinue(); return; }
    setApplying(true);
    try {
      if (canvas && canvasFields.length > 0) {
        await fetch(`/api/projects/${projectId}/idea-canvas`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(canvas),
        }).catch(() => null);
      }
      if (applicableIds.length > 0) {
        await fetch(`/api/projects/${projectId}/knowledge/apply-batch`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item_ids: applicableIds }),
        }).catch(() => null);
      }
      const chosen = monitors.filter((_, i) => checkedWatchers.has(i));
      if (chosen.length > 0) {
        await Promise.allSettled(
          chosen.map((w) =>
            fetch(`/api/projects/${projectId}/monitors`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: w.name, objective: w.aim, prompt: w.aim, schedule: w.cadence, type: 'ecosystem.custom' }),
            }).catch(() => null),
          ),
        );
      }
      // Generate the personalized opening brief LAST (so it reads the just-applied
      // canvas/entities) and AWAIT it — it persists as the first chat message, so
      // it must exist before we route into chat. Best-effort: on failure the chat
      // falls back to the deterministic briefing empty-state.
      await fetch(`/api/projects/${projectId}/brief`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      }).catch(() => null);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('lp-credits-changed', { detail: { projectId } }));
      }
    } finally {
      onContinue();
    }
  }

  // Compose the primary button label: list the actions, then ONE upfront credit
  // total (entities exact + AI brief estimate; ~ signals the brief is metered).
  // Watcher cost is weekly (shown per-row), never folded into this number.
  const N = applicableIds.length;
  const W = checkedCount;
  const actionBits = [
    canvasFields.length > 0 ? t('home.action-bit-canvas') : null,
    N > 0 ? (N === 1 ? t('home.action-bit-entity-one', { count: N }) : t('home.action-bit-entity-many', { count: N })) : null,
    W > 0 ? (W === 1 ? t('home.action-bit-watcher-one', { count: W }) : t('home.action-bit-watcher-many', { count: W })) : null,
  ].filter(Boolean);
  const primaryLabel = applying
    ? t('home.applying')
    : (actionBits.length > 0
        ? t('home.primary-apply', { actions: actionBits.join(' + ') })
        : t('home.primary-start-brief'))
      + t('home.primary-credits-suffix', { credits: upfrontCredits });

  const primaryBtnStyle: React.CSSProperties = {
    padding: '8px 16px', background: 'var(--ink)', color: 'var(--paper)', border: 'none',
    borderRadius: 'var(--r-m)', fontSize: 12.5, fontWeight: 500,
    cursor: applying ? 'wait' : 'pointer', fontFamily: 'inherit', opacity: applying ? 0.6 : 1,
  };

  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--ink-2)', marginBottom: 3 }}>
        {skipped > 0
          ? (ingested === 1
              ? t('home.read-documents-one-skipped', { count: ingested, skipped })
              : t('home.read-documents-many-skipped', { count: ingested, skipped }))
          : (ingested === 1
              ? t('home.read-documents-one', { count: ingested })
              : t('home.read-documents-many', { count: ingested }))}
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink-4)', marginBottom: 12 }}>
        {entities.length > 0
          ? (entities.length === 1
              ? t('home.pulled-entities-one', { count: entities.length })
              : t('home.pulled-entities-many', { count: entities.length }))
          : t('home.full-text-in-knowledge')}
      </div>

      {/* Spine framing — nothing turns a validation step green without the
          founder's yes, so the draft headlines WHAT this document can validate. */}
      {spineSteps > 0 && (
        <div style={{ marginBottom: 14, padding: '10px 12px', background: 'var(--accent-wash)', border: '1px solid var(--line-2)', borderRadius: 'var(--r-m)' }}>
          <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>
            {t('home.spine-framing-prefix')} <strong style={{ color: 'var(--ink)' }}>{spineSteps}</strong>{' '}
            {spineSteps === 1 ? t('home.spine-framing-suffix-one') : t('home.spine-framing-suffix-many')}
          </div>
        </div>
      )}

      {/* Canvas drafted from the docs — applying it seeds Stage 1 (Idea Validation). */}
      {canvasFields.length > 0 && (
        <div style={{ marginBottom: 14, padding: 12, background: 'var(--paper)', border: '1px solid var(--line-2)', borderRadius: 'var(--r-m)' }}>
          <div style={{ fontSize: 11, color: 'var(--ink-5)', textTransform: 'uppercase', letterSpacing: 0.4, fontFamily: 'var(--f-mono)', marginBottom: 8 }}>
            {t('home.canvas-drafted-heading')} <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--ink-6)' }}>{t('home.canvas-drafted-free')}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 240, overflowY: 'auto' }}>
            {canvasFields.map((f) => (
              <div key={f.key}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)' }}>{t(f.labelKey)}</div>
                  {canvasValidates[f.key] && (
                    <span style={{ fontSize: 10, color: 'var(--accent-ink)' }}>{t('home.validates', { target: canvasValidates[f.key] })}</span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.45 }}>{canvas![f.key]}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {entities.length > 0 && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto', marginBottom: 6 }}>
            {entities.map((e, i) => (
              <div
                key={`${e.name}-${i}`}
                style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '7px 10px', background: 'var(--paper)', border: '1px solid var(--line-2)', borderRadius: 'var(--r-m)' }}
              >
                <span className="lp-dot" style={{ background: NODE_COLORS[e.node_type] || 'var(--ink-5)', marginTop: 5, flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>
                    {e.name}
                    <span style={{ fontWeight: 400, color: 'var(--ink-5)', fontSize: 11 }}> · {e.node_type.replace(/_/g, ' ')}</span>
                  </div>
                  {e.validates && (
                    <div style={{ fontSize: 10, color: 'var(--accent-ink)', marginTop: 1 }}>{t('home.validates', { target: e.validates })}</div>
                  )}
                  {e.summary && (
                    <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 1, lineHeight: 1.4 }}>{e.summary}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
          {applicableIds.length > 0 && (
            <div style={{ fontSize: 11, color: 'var(--ink-5)', marginBottom: 14 }}>
              {applicableIds.length === 1
                ? t('home.apply-entities-line-one', { count: applicableIds.length, credits: applyCredits })
                : t('home.apply-entities-line-many', { count: applicableIds.length, credits: applyCredits })}
            </div>
          )}
        </>
      )}

      {/* Suggested watchers — recurring scans, opt-in (each priced per week). */}
      {monitors.length > 0 && (
        <div style={{ marginBottom: 14, padding: 12, background: 'var(--paper)', border: '1px solid var(--line-2)', borderRadius: 'var(--r-m)' }}>
          <div style={{ fontSize: 11, color: 'var(--ink-5)', textTransform: 'uppercase', letterSpacing: 0.4, fontFamily: 'var(--f-mono)', marginBottom: 8 }}>
            {t('home.suggested-watchers-heading')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {monitors.map((w, i) => (
              <label key={`${w.name}-${i}`} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={checkedWatchers.has(i)}
                  onChange={() => toggleWatcher(i)}
                  style={{ marginTop: 3, flexShrink: 0 }}
                />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>{w.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-4)', lineHeight: 1.4 }}>{w.aim}</div>
                  <div className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)', marginTop: 1 }}>
                    {w.cadence} · {watcherWeeklyLabel(w.cadence)}
                  </div>
                </div>
              </label>
            ))}
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--ink-6)', marginTop: 8, lineHeight: 1.4 }}>
            {t('home.watchers-footnote')}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={applyAndContinue} disabled={applying} style={primaryBtnStyle}>
          {primaryLabel}
        </button>
        {(canvasFields.length > 0 || applicableIds.length > 0 || monitors.length > 0) && (
          <button
            onClick={onContinue}
            disabled={applying}
            style={{ padding: '8px 10px', background: 'transparent', color: 'var(--ink-4)', border: 'none', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline', textUnderlineOffset: 3 }}
          >
            {t('home.skip')}
          </button>
        )}
      </div>
      <div style={{ fontSize: 10.5, color: 'var(--ink-6)', marginTop: 8, lineHeight: 1.4 }}>
        {t('home.credits-footnote', {
          total: upfrontCredits,
          applyClause: applyCredits > 0 ? t('home.credits-footnote-apply-clause', { credits: applyCredits }) : '',
          brief: BRIEF_CREDITS_EST,
        })}
      </div>
    </div>
  );
}
