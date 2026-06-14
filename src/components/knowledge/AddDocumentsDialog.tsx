'use client';

/**
 * AddDocumentsDialog — popup that runs the SAME extract pipeline as onboarding,
 * on demand from the Knowledge page, with a flat per-document audit charge.
 *
 * Flow (a small state machine):
 *   pick ─▶ ready ──run audit──▶ review ──apply (free)──▶ done
 *
 *  1. pick     drag/drop or browse (PDF via unpdf, .docx via mammoth, text).
 *  2. ready     we show the selected files and the flat fee — DOCUMENT_AUDIT_
 *               CREDITS per document — BEFORE charging. Nothing has been spent
 *               or uploaded yet; the founder confirms.
 *  3. audit     "Run audit" → POST /knowledge/upload?extract=1&audit_charge=1.
 *               The server ingests each file (applied memory_fact), runs Haiku
 *               to propose entities (pending graph_nodes), and bills the flat
 *               fee per INGESTED document (skipped files cost nothing).
 *  4. review    choose which proposed entities to add to the graph. Applying is
 *               FREE here — the per-document audit fee already covered it.
 *  5. apply     POST /knowledge/apply-batch { item_ids, skip_charge: true }.
 *
 * Founder decision 2026-06-14: documents are priced per-document at a flat rate;
 * applying the entities the audit surfaces is included.
 */

import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { Icon, I } from '@/components/design/primitives';
import { NODE_COLORS } from '@/types/graph';
import { DOCUMENT_AUDIT_CREDITS } from '@/lib/credit-costs';
import { initialSelection } from './apply-selection';

/** One entity proposal returned by /knowledge/upload?extract=1. */
export interface ExtractedEntity {
  name: string;
  node_type: string;
  summary: string;
  filename?: string;
  /** Pending graph_node id. Absent when the entity was de-duped (already present). */
  node_id?: string;
  /** Spine substep this entity would turn green, or null. */
  validates?: string | null;
}

type Phase = 'pick' | 'ready' | 'uploading' | 'review' | 'applying' | 'done';

export interface AddDocumentsDialogProps {
  projectId: string;
  onClose: () => void;
  /** Fired after the flow completes so the parent can refetch the graph.
   *  `creditsDebited` is the flat audit fee actually charged. */
  onApplied: (appliedCount: number, creditsDebited: number) => void;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AddDocumentsDialog({ projectId, onClose, onApplied }: AddDocumentsDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [isDragging, setIsDragging] = useState(false);
  const [phase, setPhase] = useState<Phase>('pick');
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [entities, setEntities] = useState<ExtractedEntity[]>([]);
  const [ingested, setIngested] = useState(0);
  const [auditCredits, setAuditCredits] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [appliedCount, setAppliedCount] = useState(0);

  // Esc closes the dialog, but not mid-flight (a stray Esc between charge and
  // apply could orphan the founder after they've paid).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && phase !== 'uploading' && phase !== 'applying') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, onClose]);

  // Flat fee shown BEFORE charging — an estimate, since skipped files cost
  // nothing server-side. The actual charge comes back as audit_credits_debited.
  const estimatedCost = files.length * DOCUMENT_AUDIT_CREDITS;

  // Entities that can actually be applied (carry a fresh pending node_id).
  const applicable = useMemo(() => entities.filter((e) => !!e.node_id), [entities]);

  function chooseFiles(list: FileList | File[]) {
    const arr = Array.from(list);
    if (arr.length === 0) return;
    setFiles(arr);
    setError(null);
    setPhase('ready');
  }

  const runAudit = useCallback(async () => {
    if (files.length === 0) return;
    setPhase('uploading');
    setError(null);
    try {
      const form = new FormData();
      for (const f of files) form.append('file', f);
      // extract=1 → propose entities · audit_charge=1 → bill the flat per-doc fee.
      const res = await fetch(`/api/projects/${projectId}/knowledge/upload?extract=1&audit_charge=1`, {
        method: 'POST',
        body: form,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        setError(body?.error ?? `Audit failed (HTTP ${res.status}).`);
        setPhase('ready');
        return;
      }
      const ext: ExtractedEntity[] = body.data?.extracted_entities ?? [];
      const credits = body.data?.audit_credits_debited ?? 0;
      setEntities(ext);
      setIngested(body.data?.ingested ?? 0);
      setAuditCredits(credits);
      setSelected(initialSelection(ext));
      // The fee was charged server-side — refresh the credits badge now.
      if (credits > 0) window.dispatchEvent(new CustomEvent('lp-credits-changed'));
      setPhase('review');
    } catch (e) {
      setError((e as Error).message || 'Audit failed.');
      setPhase('ready');
    }
  }, [projectId, files]);

  const apply = useCallback(async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) {
      // Nothing chosen — done. The documents are ingested; the audit fee stands.
      setAppliedCount(0);
      onApplied(0, auditCredits);
      setPhase('done');
      return;
    }
    setPhase('applying');
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/knowledge/apply-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // skip_charge: the flat audit fee already covered applying.
        body: JSON.stringify({ item_ids: ids, skip_charge: true }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        setError(body?.error ?? `Apply failed (HTTP ${res.status}).`);
        setPhase('review');
        return;
      }
      const applied = body.data?.applied ?? 0;
      setAppliedCount(applied);
      onApplied(applied, auditCredits);
      setPhase('done');
    } catch (e) {
      setError((e as Error).message || 'Apply failed.');
      setPhase('review');
    }
  }, [projectId, selected, auditCredits, onApplied]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function selectAll() { setSelected(new Set(applicable.map((e) => e.node_id!).filter(Boolean))); }
  function selectNone() { setSelected(new Set()); }

  function reset() {
    setPhase('pick'); setFiles([]); setEntities([]); setSelected(new Set());
    setIngested(0); setAuditCredits(0); setAppliedCount(0); setError(null);
  }

  // ── drag/drop (counter pattern: child boundaries fire dragleave) ──
  function onDragEnter(e: React.DragEvent) { e.preventDefault(); dragDepth.current += 1; setIsDragging(true); }
  function onDragLeave(e: React.DragEvent) { e.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setIsDragging(false); }
  function onDragOver(e: React.DragEvent) { e.preventDefault(); }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    dragDepth.current = 0;
    setIsDragging(false);
    if (e.dataTransfer.files?.length) chooseFiles(e.dataTransfer.files);
  }

  const busy = phase === 'uploading' || phase === 'applying';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add documents to knowledge"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(20,18,16,0.42)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 560, maxHeight: '86vh', display: 'flex', flexDirection: 'column',
          background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-l)',
          boxShadow: '0 24px 60px rgba(20,18,16,0.30)', overflow: 'hidden',
        }}
      >
        {/* Header */}
        <header style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '13px 16px', borderBottom: '1px solid var(--line)' }}>
          <Icon d={I.file} size={14} stroke={1.5} style={{ color: 'var(--ink-3)' }} />
          <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Add documents to knowledge</h2>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--ink-5)', lineHeight: 0 }}>
            <Icon d={I.x} size={15} stroke={1.6} />
          </button>
        </header>

        {/* Body (scrolls) */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 16 }}>
          {error && (
            <div style={{ fontSize: 11.5, color: 'var(--clay)', background: 'rgba(180,80,40,0.08)', border: '1px solid rgba(180,80,40,0.3)', borderRadius: 6, padding: '7px 9px', marginBottom: 12 }}>
              {error}
            </div>
          )}

          {phase === 'pick' && (
            <div
              onDragEnter={onDragEnter}
              onDragLeave={onDragLeave}
              onDragOver={onDragOver}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click(); } }}
              style={{
                border: `1.5px dashed ${isDragging ? 'var(--accent)' : 'var(--line)'}`,
                background: isDragging ? 'var(--accent-wash, var(--paper-2))' : 'var(--paper-2)',
                borderRadius: 'var(--r-m)', padding: '34px 16px',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, cursor: 'pointer', textAlign: 'center',
              }}
            >
              <Icon d={I.download} size={20} stroke={1.4} style={{ color: 'var(--ink-3)', transform: 'rotate(180deg)' }} />
              <div style={{ fontSize: 13.5, color: 'var(--ink-2)' }}>
                <strong style={{ color: 'var(--ink)' }}>Drop documents here</strong> or click to browse
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-5)', fontFamily: 'var(--f-mono)' }}>
                PDF, Word (.docx), Markdown, text · {DOCUMENT_AUDIT_CREDITS} credits each · 10 MiB max
              </div>
            </div>
          )}

          {(phase === 'ready' || phase === 'uploading') && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: 0, lineHeight: 1.5 }}>
                {phase === 'uploading'
                  ? 'Reading documents & extracting entities…'
                  : <>Auditing a document ingests it and pulls out entities for your graph. It costs a flat <strong style={{ color: 'var(--ink)' }}>{DOCUMENT_AUDIT_CREDITS} credits per document</strong>. Applying what it finds is included.</>}
              </p>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 11px', border: '1px solid var(--line)', borderRadius: 'var(--r-m)', background: 'var(--surface)' }}>
                    <Icon d={I.file} size={13} stroke={1.4} style={{ color: 'var(--ink-3)', flexShrink: 0 }} />
                    <span style={{ fontSize: 12.5, fontFamily: 'var(--f-mono)', color: 'var(--ink-2)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                    <span style={{ fontSize: 11, color: 'var(--ink-5)' }}>{fmtBytes(f.size)}</span>
                    <span className="lp-mono" style={{ fontSize: 10.5, color: 'var(--ink-3)', background: 'var(--paper-2)', border: '1px solid var(--line)', borderRadius: 4, padding: '1px 6px' }}>{DOCUMENT_AUDIT_CREDITS} cr</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(phase === 'review' || phase === 'applying') && (
            <ReviewList
              entities={entities}
              applicable={applicable}
              ingested={ingested}
              auditCredits={auditCredits}
              selected={selected}
              onToggle={toggle}
              onSelectAll={selectAll}
              onSelectNone={selectNone}
            />
          )}

          {phase === 'done' && (
            <div style={{ textAlign: 'center', padding: '24px 8px' }}>
              <div style={{ width: 38, height: 38, borderRadius: '50%', margin: '0 auto 12px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--accent-wash, var(--paper-2))', color: 'var(--moss, var(--accent))' }}>
                <Icon d={I.check} size={18} stroke={2} />
              </div>
              <div style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 600 }}>
                {appliedCount > 0
                  ? `Added ${appliedCount} ${appliedCount === 1 ? 'entity' : 'entities'} to your knowledge`
                  : 'Documents audited — nothing applied to the graph'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-5)', marginTop: 5 }}>
                {ingested} document{ingested === 1 ? '' : 's'} audited · charged {auditCredits} credit{auditCredits === 1 ? '' : 's'}.
                {appliedCount > 0 ? ' Applying was included.' : ''}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <footer style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 16px', borderTop: '1px solid var(--line)', background: 'var(--paper-2)' }}>
          {phase === 'ready' && (
            <span className="lp-mono" style={{ fontSize: 11, color: 'var(--ink-5)' }}>
              {files.length} document{files.length === 1 ? '' : 's'} · ~{estimatedCost} credits
            </span>
          )}
          {phase === 'review' && (
            <span className="lp-mono" style={{ fontSize: 11, color: 'var(--ink-5)' }}>
              {selected.size} of {applicable.length} selected · included
            </span>
          )}
          <div style={{ flex: 1 }} />

          {phase === 'done' ? (
            <>
              <button onClick={reset} style={btnGhost}>Add more</button>
              <button onClick={onClose} style={btnPrimary}>Done</button>
            </>
          ) : (
            <>
              <button onClick={onClose} disabled={busy} style={{ ...btnGhost, opacity: busy ? 0.5 : 1 }}>Cancel</button>
              {phase === 'ready' && (
                <>
                  <button onClick={() => { setFiles([]); setPhase('pick'); }} style={btnGhost}>Choose other files</button>
                  <button onClick={runAudit} style={btnPrimary}>Run audit · ~{estimatedCost} credits</button>
                </>
              )}
              {phase === 'uploading' && <button disabled style={{ ...btnPrimary, opacity: 0.6 }}>Auditing…</button>}
              {phase === 'review' && (
                <button onClick={apply} style={btnPrimary}>
                  {selected.size === 0 ? 'Skip — apply none' : `Add ${selected.size} to knowledge`}
                </button>
              )}
              {phase === 'applying' && <button disabled style={{ ...btnPrimary, opacity: 0.6 }}>Applying…</button>}
            </>
          )}

          <input
            ref={inputRef}
            type="file"
            multiple
            onChange={(e) => { const f = e.target.files; if (f) chooseFiles(f); e.target.value = ''; }}
            style={{ display: 'none' }}
            accept=".pdf,.docx,.md,.markdown,.txt,.csv,.tsv,.json,.yaml,.yml,.xml,.html,.htm,.log,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/*"
          />
        </footer>
      </div>
    </div>
  );
}

function ReviewList({
  entities, applicable, ingested, auditCredits, selected, onToggle, onSelectAll, onSelectNone,
}: {
  entities: ExtractedEntity[];
  applicable: ExtractedEntity[];
  ingested: number;
  auditCredits: number;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
}) {
  if (entities.length === 0) {
    return (
      <p style={{ fontSize: 12.5, color: 'var(--ink-5)', lineHeight: 1.5, margin: 0 }}>
        Audited {ingested} document{ingested === 1 ? '' : 's'} (charged {auditCredits} credit{auditCredits === 1 ? '' : 's'})
        and ingested the text into your context, but found no distinct entities to add to the graph. The text is still
        searchable in chat.
      </p>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <p style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: 0, flex: 1, lineHeight: 1.45 }}>
          We pulled <strong style={{ color: 'var(--ink)' }}>{applicable.length}</strong> {applicable.length === 1 ? 'entity' : 'entities'} from
          your documents. Choose what to add — applying is included in the {auditCredits}-credit audit.
        </p>
        <button onClick={onSelectAll} style={linkBtn}>All</button>
        <span style={{ color: 'var(--ink-5)' }}>·</span>
        <button onClick={onSelectNone} style={linkBtn}>None</button>
      </div>

      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {entities.map((e, i) => {
          const id = e.node_id;
          const deduped = !id;
          const checked = !!id && selected.has(id);
          return (
            <li
              key={id ?? `${e.name}-${i}`}
              onClick={() => id && onToggle(id)}
              style={{
                display: 'flex', gap: 10, alignItems: 'flex-start', padding: '9px 11px',
                border: `1px solid ${checked ? 'var(--accent)' : 'var(--line)'}`,
                background: checked ? 'var(--accent-wash, var(--paper-2))' : 'var(--surface)',
                borderRadius: 'var(--r-m)', cursor: deduped ? 'default' : 'pointer', opacity: deduped ? 0.55 : 1,
              }}
            >
              <span
                aria-hidden
                style={{
                  marginTop: 2, width: 15, height: 15, flexShrink: 0, borderRadius: 4,
                  border: `1.5px solid ${checked ? 'var(--accent)' : 'var(--line)'}`,
                  background: checked ? 'var(--accent)' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
                }}
              >
                {checked && <Icon d={I.check} size={10} stroke={2.4} />}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{e.name}</span>
                  <TypeBadge type={e.node_type} />
                  {deduped && <span className="lp-mono" style={{ fontSize: 9.5, color: 'var(--ink-5)' }}>already in graph</span>}
                </div>
                {e.summary && <div style={{ fontSize: 11.5, color: 'var(--ink-5)', marginTop: 2, lineHeight: 1.4 }}>{e.summary}</div>}
                {e.validates && (
                  <div style={{ fontSize: 10.5, color: 'var(--moss, var(--accent))', marginTop: 3, fontFamily: 'var(--f-mono)' }}>
                    ✓ validates {e.validates}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function TypeBadge({ type }: { type: string }) {
  const color = NODE_COLORS[type] ?? 'var(--ink-5)';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 9.5, fontFamily: 'var(--f-mono)', textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--ink-3)', border: '1px solid var(--line)', borderRadius: 4, padding: '1px 5px' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
      {type.replace(/_/g, ' ')}
    </span>
  );
}

const btnPrimary: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, color: '#fff', background: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 'var(--r-m)', padding: '7px 13px', cursor: 'pointer' };
const btnGhost: React.CSSProperties = { fontSize: 12.5, color: 'var(--ink-2)', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-m)', padding: '7px 13px', cursor: 'pointer' };
const linkBtn: React.CSSProperties = { fontSize: 11, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 600 };
