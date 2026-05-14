'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import api from '@/api';
import { TopBar } from '@/components/design/chrome';
import { Pill, StatusBar, Icon, I } from '@/components/design/primitives';

interface DashboardProject {
  project_id: string;
  name: string;
  description: string;
  skills_completed: number;
  total_skills: number;
  weekly_alerts: number;
  created_at: string;
}

interface DashboardSignal {
  id: string;
  project_id: string;
  project_name: string;
  severity: string;
  message: string;
  created_at: string;
}

interface DashboardStats {
  total_projects: number;
  total_skills_completed: number;
  total_alerts_this_week: number;
}

export default function HomePage() {
  const router = useRouter();
  const [projects, setProjects] = useState<DashboardProject[]>([]);
  const [signals, setSignals] = useState<DashboardSignal[]>([]);
  const [stats, setStats] = useState<DashboardStats>({
    total_projects: 0,
    total_skills_completed: 0,
    total_alerts_this_week: 0,
  });
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [expandedSignals, setExpandedSignals] = useState<Set<string>>(new Set());

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
              total_skills_completed: 0,
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
    try {
      const { data } = await api.post('/api/projects', {
        name: newName.trim(),
        description: newDesc.trim(),
      });
      if (data.success && data.data) {
        router.push(`/project/${data.data.project_id || data.data.id}/chat`);
      } else {
        setCreateError(data.error || 'Failed to create project');
      }
    } catch (err) {
      setCreateError((err as Error).message || 'Network error — please try again');
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

  function getOneLiner(msg: string): { text: string; truncated: boolean } {
    const sep = msg.indexOf('---');
    const nl = msg.indexOf('\n');
    let end = msg.length;
    if (sep > 0 && sep < end) end = sep;
    if (nl > 0 && nl < end) end = nl;
    const line = msg.slice(0, end).trim();
    if (line.length > 120) return { text: line.slice(0, 120).trimEnd() + '…', truncated: true };
    return { text: line, truncated: line.length < msg.trim().length };
  }

  function relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  const severityKind = (s: string): 'ok' | 'warn' | 'live' | 'n' =>
    s === 'critical' ? 'live' : s === 'high' ? 'warn' : s === 'low' ? 'ok' : 'n';

  return (
    <div className="lp-frame">
      <TopBar
        breadcrumb={['Home']}
        right={
          <span className="lp-mono" style={{ fontSize: 10 }}>
            {stats.total_projects} project{stats.total_projects !== 1 ? 's' : ''}
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
            Projects
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
                {p.weekly_alerts > 0 && (
                  <span
                    style={{
                      fontSize: 9,
                      fontFamily: 'var(--f-mono)',
                      color: 'var(--clay)',
                      background: 'oklch(0.94 0.05 40)',
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
              New project
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
              Workspace
            </h1>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>
              {stats.total_skills_completed} skills completed ·{' '}
              {stats.total_alerts_this_week} signals this week
            </span>
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
                Loading…
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
                      New project
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        autoFocus
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder="Project name"
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
                        placeholder="Description (optional)"
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
                        {creating ? 'Creating…' : 'Create'}
                      </button>
                      <button
                        onClick={() => { setShowCreate(false); setNewName(''); setNewDesc(''); setCreateError(null); }}
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
                        Cancel
                      </button>
                    </div>
                    {createError && (
                      <div style={{ marginTop: 8, fontSize: 12, color: 'var(--clay, #c0392b)' }}>
                        {createError}
                      </div>
                    )}
                  </div>
                )}

                {/* Signals */}
                {signals.length > 0 && (
                  <div style={{ marginBottom: 24 }}>
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
                      Recent signals
                    </div>
                    <div
                      style={{
                        border: '1px solid var(--line)',
                        borderRadius: 'var(--r-m)',
                        overflow: 'hidden',
                        background: 'var(--surface)',
                      }}
                    >
                      {signals.map((s, i) => {
                        const expanded = expandedSignals.has(s.id);
                        const { text, truncated } = getOneLiner(s.message);
                        return (
                          <div key={s.id}>
                            <div
                              onClick={() => truncated && toggleSignal(s.id)}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                padding: '8px 12px',
                                borderBottom:
                                  i < signals.length - 1 || expanded
                                    ? '1px solid var(--line)'
                                    : 'none',
                                cursor: truncated ? 'pointer' : 'default',
                                transition: 'background .1s',
                              }}
                              className={truncated ? 'lp-rail-item' : undefined}
                            >
                              <Pill kind={severityKind(s.severity)}>{s.severity}</Pill>
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
                                {text}
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
                              {truncated && (
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
                                  whiteSpace: 'pre-wrap',
                                  maxHeight: 300,
                                  overflowY: 'auto',
                                  background: 'var(--paper-2)',
                                }}
                              >
                                {s.message}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
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
                      Projects
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
                                  }}
                                >
                                  {p.name}
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
                                {p.skills_completed}/{p.total_skills} skills
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
                        No projects yet.
                      </h3>
                      <p style={{ margin: 0, maxWidth: 360, fontSize: 13, lineHeight: 1.55 }}>
                        Create your first project to start validating your startup idea with the
                        co-pilot.
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
                        Create project
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
        heartbeatLabel="heartbeat · idle"
        gateway="pi-agent · anthropic"
        ctxLabel={`${stats.total_projects} projects`}
        budget={`${stats.total_alerts_this_week} signals`}
      />
    </div>
  );
}
