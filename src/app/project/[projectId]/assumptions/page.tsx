'use client';

/**
 * /project/:id/assumptions — full registry view.
 *
 * The destination for the Today panel's "View all" link. Founders come here to:
 *   1. See every assumption the registry has surfaced
 *   2. Filter by criticality / status / category
 *   3. Manually mark a status (validate, invalidate, accept as risk) when
 *      the automatic linker can't see the evidence
 *   4. Re-extract from a fresh context after a major pivot
 *
 * The premortem isn't a one-shot document here — it's a living table the
 * founder consults like a punch list. See src/lib/assumptions.ts for the
 * data layer + linker semantics.
 */

import { use, useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { TopBar, NavRail } from '@/components/design/chrome';
import { Pill, StatusBar, Icon, I } from '@/components/design/primitives';
import { useOpenActionCount } from '@/hooks/useOpenActionCount';

interface AssumptionRow {
  id: string;
  number: number;
  category: string;
  text: string;
  source: string | null;
  explicit: boolean;
  criticality: 'high' | 'medium' | 'low';
  status: 'open' | 'validated' | 'invalidated' | 'accepted_risk';
  validated_by_skill_completion_id: string | null;
  validation_evidence: string | null;
  invalidated_reason: string | null;
  created_at: string;
}

type StatusFilter = 'all' | 'open' | 'validated' | 'invalidated' | 'accepted_risk';
type CritFilter = 'all' | 'high' | 'medium' | 'low';

const STATUS_LABELS: Record<Exclude<StatusFilter, 'all'>, string> = {
  open: 'Open',
  validated: 'Validated',
  invalidated: 'Invalidated',
  accepted_risk: 'Accepted',
};

const CATEGORY_LABELS: Record<string, string> = {
  market: 'Market',
  user_behavior: 'User',
  execution: 'Execution',
  financial: 'Financial',
  competitive: 'Competitive',
  org: 'Org',
  external: 'External',
};

export default function AssumptionsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const { count: inboxBadge } = useOpenActionCount(projectId);

  const [rows, setRows] = useState<AssumptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');
  const [critFilter, setCritFilter] = useState<CritFilter>('all');
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/assumptions`);
      const body = await res.json();
      if (body.success && Array.isArray(body.data)) {
        setRows(body.data as AssumptionRow[]);
      }
    } catch {
      /* partial state ok */
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (critFilter !== 'all' && r.criticality !== critFilter) return false;
      return true;
    });
  }, [rows, statusFilter, critFilter]);

  const counts = useMemo(() => ({
    total: rows.length,
    open_high: rows.filter((r) => r.status === 'open' && r.criticality === 'high').length,
    validated: rows.filter((r) => r.status === 'validated').length,
  }), [rows]);

  async function mutate(id: string, body: Record<string, unknown>) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/projects/${projectId}/assumptions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchRows();
    } catch (e) {
      console.warn('assumption mutate failed:', (e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="lp-frame">
      <TopBar
        breadcrumb={['Project', 'Assumptions']}
        right={
          <Pill kind={counts.open_high > 0 ? 'warn' : 'ok'} dot>
            {counts.open_high} high open · {counts.validated}/{counts.total} validated
          </Pill>
        }
      />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <NavRail projectId={projectId} current="assumptions" inboxBadge={inboxBadge} />

        <div style={{ flex: 1, overflow: 'auto', padding: '24px 32px', background: 'var(--paper)' }}>
          <header style={{ marginBottom: 20 }}>
            <h1
              className="lp-serif"
              style={{ margin: 0, fontSize: 26, fontWeight: 400, letterSpacing: -0.6, lineHeight: 1.1 }}
            >
              Assumptions.
            </h1>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--ink-4)' }}>
              The beliefs your project rests on. Skill outputs validate or invalidate them automatically;
              you can override below.
            </p>
          </header>

          {/* Filters */}
          <div
            style={{
              display: 'flex',
              gap: 16,
              padding: '12px 14px',
              background: 'var(--surface)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-l)',
              marginBottom: 16,
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            <FilterGroup
              label="Status"
              options={[
                { value: 'all', label: 'All' },
                { value: 'open', label: 'Open' },
                { value: 'validated', label: 'Validated' },
                { value: 'invalidated', label: 'Invalidated' },
                { value: 'accepted_risk', label: 'Accepted' },
              ]}
              value={statusFilter}
              onChange={(v) => setStatusFilter(v as StatusFilter)}
            />
            <FilterGroup
              label="Criticality"
              options={[
                { value: 'all', label: 'All' },
                { value: 'high', label: 'High' },
                { value: 'medium', label: 'Medium' },
                { value: 'low', label: 'Low' },
              ]}
              value={critFilter}
              onChange={(v) => setCritFilter(v as CritFilter)}
            />
            <span style={{ flex: 1 }} />
            <Link
              href={`/project/${projectId}/today`}
              style={{ fontSize: 11, color: 'var(--ink-4)', textDecoration: 'none' }}
            >
              ← Back to Today
            </Link>
          </div>

          {loading ? (
            <SkeletonList />
          ) : filtered.length === 0 ? (
            <EmptyState totalRows={rows.length} statusFilter={statusFilter} />
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {filtered.map((row) => (
                <AssumptionItem
                  key={row.id}
                  row={row}
                  busy={busyId === row.id}
                  onValidate={(evidence) => mutate(row.id, { status: 'validated', evidence })}
                  onInvalidate={(reason) => mutate(row.id, { status: 'invalidated', reason })}
                  onAccept={(reason) => mutate(row.id, { status: 'accepted_risk', reason })}
                  onReopen={() => mutate(row.id, { status: 'open' })}
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      <StatusBar
        heartbeatLabel="heartbeat · idle"
        gateway="pi-agent · anthropic"
        ctxLabel={`${counts.total} assumptions · ${counts.validated} validated`}
        budget={`${counts.open_high} high open`}
      />
    </div>
  );
}

// =============================================================================
// Subcomponents
// =============================================================================

function FilterGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span
        className="lp-mono"
        style={{
          fontSize: 9,
          color: 'var(--ink-5)',
          textTransform: 'uppercase',
          letterSpacing: 0.6,
          marginRight: 2,
        }}
      >
        {label}
      </span>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            style={{
              fontSize: 11,
              padding: '3px 9px',
              borderRadius: 12,
              border: '1px solid ' + (active ? 'var(--ink)' : 'var(--line)'),
              background: active ? 'var(--ink)' : 'transparent',
              color: active ? 'var(--paper)' : 'var(--ink-3)',
              cursor: 'pointer',
              fontWeight: active ? 500 : 400,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function AssumptionItem({
  row,
  busy,
  onValidate,
  onInvalidate,
  onAccept,
  onReopen,
}: {
  row: AssumptionRow;
  busy: boolean;
  onValidate: (evidence: string) => void;
  onInvalidate: (reason: string) => void;
  onAccept: (reason: string) => void;
  onReopen: () => void;
}) {
  const critKind: 'warn' | 'n' | 'ok' =
    row.criticality === 'high' ? 'warn' : row.criticality === 'medium' ? 'n' : 'ok';
  const statusKind: 'warn' | 'ok' | 'n' =
    row.status === 'open' ? 'warn' : row.status === 'validated' ? 'ok' : 'n';

  function promptAndRun(action: 'validate' | 'invalidate' | 'accept') {
    const label =
      action === 'validate' ? 'Evidence (one sentence):' :
      action === 'invalidate' ? 'Reason this is false:' :
      'Why accept as risk?';
    const input = window.prompt(label, '');
    if (!input || input.trim().length === 0) return;
    if (action === 'validate') onValidate(input.trim());
    else if (action === 'invalidate') onInvalidate(input.trim());
    else onAccept(input.trim());
  }

  return (
    <li
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderLeft: row.criticality === 'high' && row.status === 'open' ? '3px solid var(--clay)' : '1px solid var(--line)',
        borderRadius: 'var(--r-l)',
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span
          className="lp-mono"
          style={{ fontSize: 10, color: 'var(--ink-5)', minWidth: 30 }}
        >
          #{row.number}
        </span>
        <Pill kind={critKind} dot={row.criticality === 'high'}>
          {row.criticality}
        </Pill>
        <Pill kind={statusKind}>
          {STATUS_LABELS[row.status as Exclude<StatusFilter, 'all'>] || row.status}
        </Pill>
        <span
          className="lp-mono"
          style={{ fontSize: 10, color: 'var(--ink-5)', textTransform: 'uppercase', letterSpacing: 0.4 }}
        >
          {CATEGORY_LABELS[row.category] ?? row.category}
        </span>
      </header>

      <p style={{ margin: 0, fontSize: 14, color: 'var(--ink)', lineHeight: 1.4 }}>
        {row.text}
      </p>

      {row.status === 'validated' && row.validation_evidence && (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-3)', fontStyle: 'italic' }}>
          <Icon d={I.check} size={11} /> {row.validation_evidence}
          {row.validated_by_skill_completion_id && (
            <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)', marginLeft: 6 }}>
              · linked to skill completion
            </span>
          )}
        </p>
      )}

      {(row.status === 'invalidated' || row.status === 'accepted_risk') && row.invalidated_reason && (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-3)', fontStyle: 'italic' }}>
          {row.status === 'invalidated' ? '✕' : '○'} {row.invalidated_reason}
        </p>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
        {row.status === 'open' && (
          <>
            <ActionBtn disabled={busy} onClick={() => promptAndRun('validate')} label="Validate" />
            <ActionBtn disabled={busy} onClick={() => promptAndRun('invalidate')} label="Invalidate" />
            <ActionBtn disabled={busy} onClick={() => promptAndRun('accept')} label="Accept as risk" />
          </>
        )}
        {row.status !== 'open' && (
          <ActionBtn disabled={busy} onClick={onReopen} label="Reopen" />
        )}
      </div>
    </li>
  );
}

function ActionBtn({ disabled, onClick, label }: { disabled: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        fontSize: 11,
        padding: '4px 10px',
        borderRadius: 4,
        border: '1px solid var(--line)',
        background: 'transparent',
        color: 'var(--ink-2)',
        cursor: disabled ? 'wait' : 'pointer',
      }}
    >
      {label}
    </button>
  );
}

function SkeletonList() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            height: 80,
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-l)',
            opacity: 0.5,
          }}
        />
      ))}
    </div>
  );
}

function EmptyState({ totalRows, statusFilter }: { totalRows: number; statusFilter: StatusFilter }) {
  if (totalRows === 0) {
    return (
      <section
        style={{
          background: 'var(--surface)',
          border: '1px dashed var(--line)',
          borderRadius: 'var(--r-l)',
          padding: '40px 24px',
          textAlign: 'center',
          color: 'var(--ink-4)',
          fontSize: 13,
        }}
      >
        No assumptions yet. They appear after the first context save, or when
        you ask the co-pilot to run a premortem.
      </section>
    );
  }
  return (
    <section
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-l)',
        padding: '24px',
        textAlign: 'center',
        color: 'var(--ink-4)',
        fontSize: 12.5,
      }}
    >
      No assumptions match the current filter ({statusFilter}). Try another status above.
    </section>
  );
}
