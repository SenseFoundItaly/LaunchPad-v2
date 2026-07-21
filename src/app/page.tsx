'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import api from '@/api';
import { deleteProject } from '@/api/projects';
import { TopBar } from '@/components/design/chrome';
import { Pill, Icon, I } from '@/components/design/primitives';
import { NODE_COLORS } from '@/types/graph';
import { useT, useLocale } from '@/components/providers/LocaleProvider';
import { SUPPORTED_LOCALES, LOCALE_NATIVE_NAME, type Locale } from '@/lib/i18n/locales';
import type { MessageKey } from '@/lib/i18n/messages';
import { checkLabel, stageLabel } from '@/lib/journey-prompts';


// Lean-canvas fields the upload extractor proposes from a founder's docs.
type ProposedCanvas = {
  problem: string;
  solution: string;
  target_market: string;
  value_proposition: string;
  business_model: string;
  competitive_advantage: string;
  channels: string;
};
// Wire shape of the upload extractor's per-stage spine preview (stage → checks
// filled → the statement filling each). Mirrors buildSpinePreview's output —
// declared locally because validation-targets is server-only.
type SpinePreviewStage = {
  stage_number: number;
  stage_id: string;
  stage_label: string;
  total_checks: number;
  checks: Array<{
    check_id: string;
    check_label: string;
    statements: Array<{ kind: 'canvas_field' | 'entity'; field?: string; name?: string; statement: string }>;
  }>;
};

const CANVAS_FIELD_LABELS: Array<{ key: keyof ProposedCanvas; labelKey: MessageKey }> = [
  { key: 'problem', labelKey: 'home.canvas-field-problem' },
  { key: 'solution', labelKey: 'home.canvas-field-solution' },
  { key: 'target_market', labelKey: 'home.canvas-field-target-market' },
  { key: 'value_proposition', labelKey: 'home.canvas-field-value-proposition' },
  { key: 'competitive_advantage', labelKey: 'home.canvas-field-competitive-edge' },
  { key: 'business_model', labelKey: 'home.canvas-field-business-model' },
  { key: 'channels', labelKey: 'home.canvas-field-channels' },
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
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  // Locale is frozen at creation (a project stays in the language it's made in),
  // so the create form is the only place to pick it. Default to the founder's
  // account language → no change for single-language users.
  const accountLocale = useLocale();
  const [newLocale, setNewLocale] = useState<Locale>(accountLocale);
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
    ideaBrief: string;
    spinePreview: SpinePreviewStage[];
  } | null>(null);
  const [expandedSignals, setExpandedSignals] = useState<Set<string>>(new Set());
  const [showSignals, setShowSignals] = useState(false);
  const signalPanelRef = useRef<HTMLDivElement>(null);
  // Hover state for the Create button's "why is this disabled" tooltip.
  const [showNameTip, setShowNameTip] = useState(false);

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

  // Tear down the full-screen create takeover and reset every create-flow field.
  const resetCreate = useCallback(() => {
    setShowCreate(false);
    setNewName('');
    setNewDesc('');
    setNewLocale(accountLocale);
    setCreateError(null);
    setCreateMode('scratch');
    setCreateFiles([]);
    setUploadStatus(null);
    setExtractResult(null);
    setCreatedProjectId(null);
    setShowNameTip(false);
  }, [accountLocale]);

  // Esc dismisses the takeover — but not mid-upload, so we don't strand an
  // in-flight project create/extract.
  useEffect(() => {
    if (!showCreate) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !creating) resetCreate();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showCreate, creating, resetCreate]);

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
        locale: newLocale,
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
              idea_brief?: string;
              spine_preview?: SpinePreviewStage[];
            };
            setExtractResult({
              ingested: d.ingested ?? 0,
              skipped: d.skipped ?? 0,
              entities: Array.isArray(d.extracted_entities) ? d.extracted_entities : [],
              canvas: d.proposed_canvas ?? null,
              canvasValidates: d.canvas_validates ?? {},
              spineSteps: d.spine_steps ?? 0,
              ideaBrief: typeof d.idea_brief === 'string' ? d.idea_brief : '',
              spinePreview: Array.isArray(d.spine_preview) ? d.spine_preview : [],
            });
            setCreating(false);
            return; // show the results view; route to project Home on "Continue"
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

      // Land on the project Home ("Start here" onboarding card), not the
      // co-pilot — new founders need orientation before the chat.
      router.push(`/project/${projectId}/today`);
    } catch (err) {
      setCreateError((err as Error).message || t('home.error-network'));
    }
    setCreating(false);
  }

  // Hard delete via the existing owner-only API (children CASCADE). The
  // window.confirm + i18n-key pattern matches DataRoomPanel's delete.
  async function handleDeleteProject(p: DashboardProject) {
    if (deletingId) return;
    if (!confirm(t('home.delete-confirm', { name: p.name }))) return;
    setDeletingId(p.project_id);
    try {
      await deleteProject(p.project_id);
      setProjects((prev) => prev.filter((x) => x.project_id !== p.project_id));
      setStats((prev) => ({ ...prev, total_projects: Math.max(0, prev.total_projects - 1) }));
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status;
      alert(t(status === 403 ? 'home.delete-owner-only' : 'home.delete-failed'));
    }
    setDeletingId(null);
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
          {/* Content header — hidden during the full-screen create takeover */}
          {!showCreate && (
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
                data-tour="dash-signals"
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
            {/* Primary CTA — moved here from the retired left projects rail
                (the rail duplicated the main grid; feedback 2026-07-21). */}
            <button
              data-tour="new-project"
              onClick={() => setShowCreate(true)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--on-accent)',
                background: 'var(--accent)',
                border: 'none',
                borderRadius: 'var(--r-m)',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <Icon d={I.plus} size={12} stroke={1.8} />
              {t('home.new-project')}
            </button>
          </div>
          )}

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
                    style={{ maxWidth: 720, margin: '24px auto 0', width: '100%' }}
                  >
                    <div className="lp-serif" style={{ fontSize: 20, fontWeight: 400, letterSpacing: -0.3, marginBottom: 16 }}>
                      {t('home.new-project')}
                    </div>

                    {extractResult ? (
                      <ExtractedKnowledgeView
                        result={extractResult}
                        projectId={createdProjectId}
                        descriptionMissing={!newDesc.trim()}
                        onContinue={() => {
                          if (createdProjectId) router.push(`/project/${createdProjectId}/today`);
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
                      <select
                        value={newLocale}
                        onChange={(e) => setNewLocale(e.target.value as Locale)}
                        aria-label={t('home.project-language-label')}
                        title={t('home.project-language-label')}
                        style={{
                          flex: 'none',
                          padding: '7px 10px',
                          background: 'var(--paper)',
                          border: '1px solid var(--line-2)',
                          borderRadius: 'var(--r-m)',
                          fontSize: 13,
                          color: 'var(--ink-2)',
                          fontFamily: 'inherit',
                          outline: 'none',
                          cursor: 'pointer',
                        }}
                      >
                        {SUPPORTED_LOCALES.map((loc) => (
                          <option key={loc} value={loc}>
                            {LOCALE_NATIVE_NAME[loc]}
                          </option>
                        ))}
                      </select>
                      <span
                        style={{ position: 'relative', display: 'inline-flex' }}
                        onMouseEnter={() => setShowNameTip(true)}
                        onMouseLeave={() => setShowNameTip(false)}
                      >
                        <button
                          onClick={handleCreate}
                          disabled={creating || !newName.trim()}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '7px 14px',
                            background: 'var(--ink)',
                            color: 'var(--paper)',
                            border: 'none',
                            borderRadius: 'var(--r-m)',
                            fontSize: 12,
                            fontWeight: 500,
                            cursor: creating || !newName.trim() ? 'default' : 'pointer',
                            fontFamily: 'inherit',
                            opacity: creating || !newName.trim() ? 0.5 : 1,
                          }}
                        >
                          {creating && <SpinnerIcon size={12} />}
                          {creating ? (uploadStatus ? t('home.uploading') : t('home.creating')) : t('home.create')}
                        </button>
                        {/* Explain why the button is disabled when it's purely a missing name */}
                        {!creating && !newName.trim() && showNameTip && (
                          <span
                            role="tooltip"
                            style={{
                              position: 'absolute',
                              bottom: 'calc(100% + 6px)',
                              left: '50%',
                              transform: 'translateX(-50%)',
                              background: 'var(--ink)',
                              color: 'var(--paper)',
                              fontSize: 11,
                              lineHeight: 1.3,
                              padding: '4px 8px',
                              borderRadius: 'var(--r-s, 4px)',
                              whiteSpace: 'nowrap',
                              boxShadow: 'var(--shadow-lift)',
                              zIndex: 10,
                              pointerEvents: 'none',
                            }}
                          >
                            {t('home.create-disabled-name-tip')}
                          </span>
                        )}
                      </span>
                      <button
                        onClick={resetCreate}
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

                {/* Projects grid — hidden during the full-screen create takeover */}
                {!showCreate && (projects.length > 0 ? (
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
                      data-tour="projects-grid"
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
                              {p.access_kind !== 'member' && (
                                <button
                                  type="button"
                                  className="lp-card-action"
                                  title={t('home.delete-project')}
                                  aria-label={t('home.delete-project')}
                                  disabled={deletingId === p.project_id}
                                  onClick={(e) => {
                                    // The card is wrapped in a Link — stop both
                                    // navigation and bubbling before deleting.
                                    e.preventDefault();
                                    e.stopPropagation();
                                    void handleDeleteProject(p);
                                  }}
                                  style={{
                                    flexShrink: 0,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    width: 24,
                                    height: 24,
                                    padding: 0,
                                    border: 'none',
                                    borderRadius: 'var(--r-s)',
                                    background: 'transparent',
                                    color: 'var(--ink-4)',
                                    cursor: deletingId === p.project_id ? 'default' : 'pointer',
                                  }}
                                >
                                  <Icon d={I.trash} size={14} stroke={1.6} />
                                </button>
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
                        data-tour="new-project"
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
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function safeHost(url: string): string {
  try { return new URL(url).hostname; } catch { return url.slice(0, 40); }
}

// ─── Knowledge-populating flow (create-from-documents) ───────────────────────

/** Inline busy spinner (Tailwind's built-in `animate-spin`), mirrors the
 *  pattern used in chat/artifacts/UnifiedReviewControls. */
function SpinnerIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" className="animate-spin" aria-hidden="true">
      <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="20" strokeDashoffset="8" strokeLinecap="round" />
    </svg>
  );
}

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
  descriptionMissing,
  onContinue,
}: {
  result: { ingested: number; skipped: number; entities: Array<{ name: string; node_type: string; summary: string; filename: string; node_id?: string; validates?: string | null }>; canvas: ProposedCanvas | null; canvasValidates: Record<string, string>; spineSteps: number; ideaBrief: string; spinePreview: SpinePreviewStage[] };
  projectId: string | null;
  /** True when the founder left the create-form description blank — the
   *  (possibly edited) idea brief then becomes the project description on Apply. */
  descriptionMissing: boolean;
  onContinue: () => void;
}) {
  const t = useT();
  const { ingested, skipped, entities, canvas, canvasValidates, spineSteps, ideaBrief, spinePreview } = result;
  const [applying, setApplying] = useState(false);

  // Everything extracted is editable in place before it lands anywhere — the
  // founder's wording is what gets saved, not the extractor's. Edits live here;
  // the server copies in `result` stay pristine (they key the diff on apply).
  const [briefText, setBriefText] = useState(ideaBrief);
  const [canvasEdits, setCanvasEdits] = useState<ProposedCanvas | null>(canvas ? { ...canvas } : null);
  const [entityEdits, setEntityEdits] = useState<Array<{ name: string; summary: string }>>(
    () => entities.map((e) => ({ name: e.name, summary: e.summary })),
  );

  const canvasFields = canvas
    ? CANVAS_FIELD_LABELS.filter((f) => canvas[f.key]?.trim())
    : [];

  // Live spine preview: statements track the founder's edits, and a check
  // whose statement was cleared drops out (so the "fills X of Y" never
  // over-promises what Apply will actually write).
  const clip = (s: string, n = 280): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
  const entityEditByName = new Map(entities.map((e, i) => [e.name, entityEdits[i]]));
  const liveStatement = (st: SpinePreviewStage['checks'][number]['statements'][number]): string => {
    if (st.kind === 'canvas_field' && st.field && canvasEdits) {
      return clip((canvasEdits[st.field as keyof ProposedCanvas] ?? '').trim());
    }
    if (st.kind === 'entity' && st.name) {
      const ed = entityEditByName.get(st.name);
      if (ed) return clip((ed.summary || ed.name).trim());
    }
    return st.statement;
  };
  const displayPreview = spinePreview
    .map((s) => ({
      ...s,
      checks: s.checks
        .map((c) => ({
          ...c,
          statements: c.statements
            .map((st) => ({ ...st, statement: liveStatement(st) }))
            .filter((st) => st.statement.length > 0),
        }))
        .filter((c) => c.statements.length > 0),
    }))
    .filter((s) => s.checks.length > 0);
  const liveSpineSteps = spinePreview.length > 0
    ? displayPreview.reduce((n, s) => n + s.checks.length, 0)
    : spineSteps;

  // Applying is free (only a founder chat message costs a credit), so no cost
  // estimate is computed or shown on the home apply action.
  const applicableIds = entities.map((e) => e.node_id).filter((x): x is string => !!x);

  // Diff the founder's inline entity edits against the extractor's originals —
  // only real changes travel (apply-batch persists them before the state flip).
  function collectEntityEdits(): Record<string, { name?: string; summary?: string }> {
    const out: Record<string, { name?: string; summary?: string }> = {};
    entities.forEach((e, i) => {
      if (!e.node_id) return; // deduped hit — the node pre-exists, not ours to edit here
      const ed = entityEdits[i];
      if (!ed) return;
      const changes: { name?: string; summary?: string } = {};
      if (ed.name.trim() && ed.name.trim() !== e.name) changes.name = ed.name.trim();
      if (ed.summary.trim() !== e.summary) changes.summary = ed.summary.trim();
      if (changes.name !== undefined || changes.summary !== undefined) out[e.node_id] = changes;
    });
    return out;
  }

  // ONE commit: canvas → entity batch-apply → into chat.
  // Every sub-action is best-effort/non-fatal — the founder always routes on.
  async function applyAndContinue() {
    if (!projectId) { onContinue(); return; }
    setApplying(true);
    try {
      // A fully-cleared draft skips the write (the route 400s on all-empty).
      const editedCanvasHasContent = !!canvasEdits && Object.values(canvasEdits).some((v) => v.trim());
      if (editedCanvasHasContent) {
        await fetch(`/api/projects/${projectId}/idea-canvas`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(canvasEdits),
        }).catch(() => null);
      }
      if (applicableIds.length > 0) {
        const editPayload = collectEntityEdits();
        await fetch(`/api/projects/${projectId}/knowledge/apply-batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            Object.keys(editPayload).length > 0
              ? { item_ids: applicableIds, edits: editPayload }
              : { item_ids: applicableIds },
          ),
        }).catch(() => null);
      }
      // The idea brief becomes the project description when the founder left
      // it blank at creation — Apply is the yes that lets it persist. Runs
      // before the AI brief so the opening message can read it.
      if (descriptionMissing && briefText.trim()) {
        await fetch(`/api/projects/${projectId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description: briefText.trim().slice(0, 600) }),
        }).catch(() => null);
      }
      // (Watcher suggestions at upload time were removed — 2026-07 founder
      // decision: watchers are auto-proposed only after the Validation Gate
      // completes. Upload commits canvas + entities only.)
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

  // Skip ≠ discard: the canvas draft is already extracted (paid) — stage it as
  // a pending approval card (stage_only) so the founder can pick it up later
  // from chat/Inbox. Founder-first: staging only proposes, nothing applies.
  async function skipAndContinue() {
    if (projectId && canvasEdits && Object.values(canvasEdits).some((v) => v.trim())) {
      setApplying(true);
      // Stage the founder's EDITED wording — skip defers the decision, it
      // shouldn't discard corrections they already typed.
      await fetch(`/api/projects/${projectId}/idea-canvas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...canvasEdits, stage_only: true }),
      }).catch(() => null);
    }
    onContinue();
  }

  // Compose the primary button label: list the actions, then ONE upfront credit
  // total (entities exact + AI brief estimate; ~ signals the brief is metered).
  // Watcher cost is weekly (shown per-row), never folded into this number.
  const N = applicableIds.length;
  const actionBits = [
    canvasFields.length > 0 ? t('home.action-bit-canvas') : null,
    N > 0 ? (N === 1 ? t('home.action-bit-entity-one', { count: N }) : t('home.action-bit-entity-many', { count: N })) : null,
  ].filter(Boolean);
  const primaryLabel = applying
    ? t('home.applying')
    : (actionBits.length > 0
        ? t('home.primary-apply', { actions: actionBits.join(' + ') })
        : t('home.primary-start-brief'))
      + t('home.primary-credits-suffix');

  const primaryBtnStyle: React.CSSProperties = {
    padding: '8px 16px', background: 'var(--ink)', color: 'var(--paper)', border: 'none',
    borderRadius: 'var(--r-m)', fontSize: 12.5, fontWeight: 500,
    cursor: applying ? 'wait' : 'pointer', fontFamily: 'inherit', opacity: applying ? 0.6 : 1,
  };

  // Shared style for every inline-editable field on the review screen — the
  // visible border is the "you can type here" affordance.
  const editBoxStyle: React.CSSProperties = {
    width: '100%', padding: '6px 8px', background: 'var(--paper)',
    border: '1px solid var(--line-2)', borderRadius: 'var(--r-m)',
    fontSize: 12, color: 'var(--ink-2)', fontFamily: 'inherit', lineHeight: 1.45,
    outline: 'none', resize: 'vertical' as const, boxSizing: 'border-box' as const,
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

      {/* Everything below is editable in place before it lands anywhere. */}
      {(ideaBrief || canvasFields.length > 0 || entities.length > 0) && (
        <div style={{ fontSize: 11, color: 'var(--ink-5)', marginBottom: 10 }}>
          {t('home.edit-hint')}
        </div>
      )}

      {/* The idea in plain words — extracted alongside the canvas so the
          founder sees WHAT we understood before reviewing field-by-field.
          Editable; on Apply it becomes the project description when the
          founder left that blank at creation. */}
      {ideaBrief && (
        <div style={{ marginBottom: 14, padding: 12, background: 'var(--paper)', border: '1px solid var(--line-2)', borderRadius: 'var(--r-m)' }}>
          <div style={{ fontSize: 11, color: 'var(--ink-5)', textTransform: 'uppercase', letterSpacing: 0.4, fontFamily: 'var(--f-mono)', marginBottom: 6 }}>
            {t('home.idea-brief-heading')}
          </div>
          <textarea
            value={briefText}
            onChange={(e) => setBriefText(e.target.value)}
            rows={3}
            style={{ ...editBoxStyle, fontSize: 12.5, lineHeight: 1.55 }}
          />
        </div>
      )}

      {/* Spine framing — nothing turns a validation step green without the
          founder's yes, so the draft headlines WHAT this document can validate,
          then breaks it down per stage: each check filled + the statement
          filling it (so approval is a read of the spine, not a leap of faith). */}
      {liveSpineSteps > 0 && (
        <div style={{ marginBottom: 14, padding: '10px 12px', background: 'var(--accent-wash)', border: '1px solid var(--line-2)', borderRadius: 'var(--r-m)' }}>
          <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>
            {t('home.spine-framing-prefix')} <strong style={{ color: 'var(--ink)' }}>{liveSpineSteps}</strong>{' '}
            {liveSpineSteps === 1 ? t('home.spine-framing-suffix-one') : t('home.spine-framing-suffix-many')}
          </div>
          {displayPreview.map((s) => (
            <div key={s.stage_number} style={{ marginTop: 10 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: 0.4, fontFamily: 'var(--f-mono)' }}>
                  {t('home.spine-stage-n', { number: s.stage_number })} · {stageLabel(s.stage_id, s.stage_label, t)}
                </span>
                <span style={{ fontSize: 10.5, color: 'var(--ink-5)' }}>
                  {s.checks.length === 1
                    ? t('home.spine-stage-fills-one', { filled: s.checks.length, total: s.total_checks })
                    : t('home.spine-stage-fills-many', { filled: s.checks.length, total: s.total_checks })}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 5 }}>
                {s.checks.map((c) => (
                  <div key={c.check_id} style={{ paddingLeft: 9, borderLeft: '2px solid var(--line-2)' }}>
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-2)' }}>
                      ✓ {checkLabel(c.check_id, c.check_label, t)}
                    </div>
                    {c.statements.map((st, i) => {
                      const fieldLabelKey = st.kind === 'canvas_field'
                        ? CANVAS_FIELD_LABELS.find((f) => f.key === st.field)?.labelKey
                        : undefined;
                      const originLabel = fieldLabelKey ? t(fieldLabelKey) : st.name;
                      return (
                        <div key={i} style={{ fontSize: 11, color: 'var(--ink-4)', lineHeight: 1.45, marginTop: 2 }}>
                          {originLabel && <span style={{ color: 'var(--ink-5)', fontWeight: 500 }}>{originLabel}: </span>}
                          <span>“{st.statement}”</span>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          ))}
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
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap', marginBottom: 3 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)' }}>{t(f.labelKey)}</div>
                  {canvasValidates[f.key] && (
                    <span style={{ fontSize: 10, color: 'var(--accent-ink)' }}>{t('home.validates', { target: canvasValidates[f.key] })}</span>
                  )}
                </div>
                <textarea
                  value={canvasEdits?.[f.key] ?? ''}
                  onChange={(e) => setCanvasEdits((prev) => (prev ? { ...prev, [f.key]: e.target.value } : prev))}
                  rows={2}
                  style={editBoxStyle}
                />
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
                <div style={{ minWidth: 0, flex: 1 }}>
                  {/* Editable only for nodes THIS upload created (node_id present).
                      A dedup hit references a pre-existing node — read-only here. */}
                  {e.node_id ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        value={entityEdits[i]?.name ?? e.name}
                        onChange={(ev) => setEntityEdits((prev) => prev.map((x, j) => (j === i ? { ...x, name: ev.target.value } : x)))}
                        style={{ ...editBoxStyle, resize: undefined, padding: '4px 6px', fontSize: 12.5, fontWeight: 600, color: 'var(--ink)', flex: 1, minWidth: 0 }}
                      />
                      <span style={{ fontWeight: 400, color: 'var(--ink-5)', fontSize: 11, flexShrink: 0 }}>{e.node_type.replace(/_/g, ' ')}</span>
                    </div>
                  ) : (
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>
                      {e.name}
                      <span style={{ fontWeight: 400, color: 'var(--ink-5)', fontSize: 11 }}> · {e.node_type.replace(/_/g, ' ')}</span>
                    </div>
                  )}
                  {e.validates && (
                    <div style={{ fontSize: 10, color: 'var(--accent-ink)', marginTop: 2 }}>{t('home.validates', { target: e.validates })}</div>
                  )}
                  {e.node_id ? (
                    <textarea
                      value={entityEdits[i]?.summary ?? e.summary}
                      onChange={(ev) => setEntityEdits((prev) => prev.map((x, j) => (j === i ? { ...x, summary: ev.target.value } : x)))}
                      rows={2}
                      style={{ ...editBoxStyle, marginTop: 4, fontSize: 11 }}
                    />
                  ) : (
                    e.summary && (
                      <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 1, lineHeight: 1.4 }}>{e.summary}</div>
                    )
                  )}
                </div>
              </div>
            ))}
          </div>
          {applicableIds.length > 0 && (
            <div style={{ fontSize: 11, color: 'var(--ink-5)', marginBottom: 14 }}>
              {applicableIds.length === 1
                ? t('home.apply-entities-line-one', { count: applicableIds.length })
                : t('home.apply-entities-line-many', { count: applicableIds.length })}
            </div>
          )}
        </>
      )}

      {/* Watcher suggestions at upload time were removed (2026-07 founder
          decision) — watchers are auto-proposed after the Validation Gate. */}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={applyAndContinue} disabled={applying} style={primaryBtnStyle}>
          {primaryLabel}
        </button>
        {(canvasFields.length > 0 || applicableIds.length > 0) && (
          <button
            onClick={skipAndContinue}
            disabled={applying}
            style={{ padding: '8px 10px', background: 'transparent', color: 'var(--ink-4)', border: 'none', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline', textUnderlineOffset: 3 }}
          >
            {t('home.skip')}
          </button>
        )}
      </div>
    </div>
  );
}
