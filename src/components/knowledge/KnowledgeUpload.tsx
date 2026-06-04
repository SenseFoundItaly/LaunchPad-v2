'use client';

/**
 * KnowledgeUpload — drag-drop + file-picker that ingests files into a
 * project's knowledge base. On success, calls `onUploaded()` so the parent
 * can refresh the knowledge list.
 *
 * Posts to POST /api/projects/{projectId}/knowledge/upload, which writes
 * one memory_facts row per accepted file (text-like only; binaries/PDFs
 * are rejected server-side).
 */

import { useCallback, useRef, useState } from 'react';
import { Icon, I } from '@/components/design/primitives';

interface ResultRow {
  filename: string;
  status: 'ingested' | 'skipped';
  reason?: string;
  /** Entities proposed from this file (only present when extraction ran). */
  entities_proposed?: number;
}

export interface KnowledgeUploadProps {
  projectId: string;
  /** Called after a successful upload with the per-call counts. The second
   *  argument is the total number of new entity proposals queued — the parent
   *  can use it to flash "+N proposals" so the user knows the graph pane
   *  may show new pending nodes to review. */
  onUploaded: (ingested: number, entitiesProposed?: number) => void;
}

export default function KnowledgeUpload({ projectId, onUploaded }: KnowledgeUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  // Counter pattern: dragenter/dragleave can fire for child elements as the
  // pointer crosses internal boundaries, so we count instead of toggling.
  const dragDepth = useRef(0);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResults, setLastResults] = useState<ResultRow[]>([]);

  const upload = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploading(true);
    setError(null);
    setLastResults([]);
    try {
      const form = new FormData();
      for (const f of list) form.append('file', f);
      // ?extract=1 → run cheap Haiku entity extraction on each ingested file
      // and queue pending graph_nodes proposals. See upload/route.ts.
      const res = await fetch(`/api/projects/${projectId}/knowledge/upload?extract=1`, {
        method: 'POST',
        body: form,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        setError(body?.error ?? `Upload failed (HTTP ${res.status}).`);
        return;
      }
      const ingested = body.data?.ingested ?? 0;
      const entitiesProposed = body.data?.entities_proposed ?? 0;
      const results: ResultRow[] = body.data?.results ?? [];
      setLastResults(results);
      if (ingested > 0) onUploaded(ingested, entitiesProposed);
    } catch (e) {
      setError((e as Error).message || 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }, [projectId, onUploaded]);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (files) void upload(files);
    // Reset so picking the same file twice in a row still fires onChange.
    e.target.value = '';
  }

  function onDragEnter(e: React.DragEvent) {
    e.preventDefault();
    dragDepth.current += 1;
    setIsDragging(true);
  }
  function onDragLeave(e: React.DragEvent) {
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDragging(false);
  }
  function onDragOver(e: React.DragEvent) {
    // Required: without preventDefault on dragover, drop never fires.
    e.preventDefault();
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    dragDepth.current = 0;
    setIsDragging(false);
    if (e.dataTransfer.files?.length) void upload(e.dataTransfer.files);
  }

  return (
    <section
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-l)',
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon d={I.file} size={13} stroke={1.4} style={{ color: 'var(--ink-3)' }} />
        <h2
          style={{
            margin: 0,
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            color: 'var(--ink-3)',
          }}
        >
          Upload files
        </h2>
        <div style={{ flex: 1 }} />
        <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>
          text-only · 1 MiB max
        </span>
      </header>

      <div
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        style={{
          border: `1.5px dashed ${isDragging ? 'var(--accent)' : 'var(--line)'}`,
          background: isDragging ? 'var(--accent-wash, var(--paper-2))' : 'var(--paper-2)',
          borderRadius: 'var(--r-m)',
          padding: '22px 16px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          cursor: uploading ? 'progress' : 'pointer',
          transition: 'background .12s, border-color .12s',
          textAlign: 'center',
        }}
      >
        <Icon
          d={I.download}
          size={18}
          stroke={1.4}
          style={{ color: 'var(--ink-3)', transform: 'rotate(180deg)' }}
        />
        <div style={{ fontSize: 13, color: 'var(--ink-2)' }}>
          {uploading ? 'Uploading…' : (
            <>
              <strong style={{ color: 'var(--ink)' }}>Drop files here</strong>
              {' '}or click to browse
            </>
          )}
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink-5)', fontFamily: 'var(--f-mono)' }}>
          .md, .txt, .csv, .json, .yaml, .xml, .html, source files
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          onChange={onPick}
          style={{ display: 'none' }}
          // Hints for the picker; the server is authoritative on accept/reject.
          accept=".md,.markdown,.txt,.csv,.tsv,.json,.yaml,.yml,.xml,.html,.htm,.log,.ini,.conf,.env,.ts,.tsx,.js,.jsx,.mjs,.cjs,.py,.rb,.go,.rs,.java,.sh,.bash,.zsh,.sql,.css,.scss,.toml,text/*,application/json"
        />
      </div>

      {error && (
        <div
          style={{
            fontSize: 11,
            color: 'var(--clay)',
            background: 'rgba(180,80,40,0.08)',
            border: '1px solid rgba(180,80,40,0.3)',
            borderRadius: 6,
            padding: '6px 8px',
          }}
        >
          {error}
        </div>
      )}

      {lastResults.length > 0 && (
        <ul
          style={{
            margin: 0,
            padding: 0,
            listStyle: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
          }}
        >
          {lastResults.map((r) => (
            <li
              key={r.filename}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 11,
                color: r.status === 'ingested' ? 'var(--ink-3)' : 'var(--ink-5)',
              }}
            >
              <Icon
                d={r.status === 'ingested' ? I.check : I.x}
                size={11}
                stroke={1.5}
                style={{ color: r.status === 'ingested' ? 'var(--moss, var(--accent))' : 'var(--ink-5)' }}
              />
              <span style={{ fontFamily: 'var(--f-mono)' }}>{r.filename}</span>
              {r.reason && (
                <span style={{ color: 'var(--ink-5)' }}>— {r.reason}</span>
              )}
              {typeof r.entities_proposed === 'number' && r.entities_proposed > 0 && (
                <span
                  className="lp-mono"
                  style={{
                    color: 'var(--accent-ink, var(--ink-3))',
                    background: 'var(--accent-wash, var(--paper-2))',
                    padding: '1px 6px',
                    borderRadius: 4,
                    fontSize: 10,
                  }}
                  title="Pending entity proposals — review them in the knowledge list to add to the graph"
                >
                  +{r.entities_proposed} entit{r.entities_proposed === 1 ? 'y' : 'ies'}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
