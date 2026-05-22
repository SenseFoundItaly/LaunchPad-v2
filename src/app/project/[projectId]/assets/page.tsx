'use client';

import { use, useState, useEffect, useCallback, useMemo } from 'react';
import { STAGES } from '@/lib/stages';
import { useSkillStatus } from '@/hooks/useSkillStatus';
import { openPrintPreview } from '@/lib/print-utils';
import { parseMessageContent } from '@/lib/artifact-parser';
import SkillOutputRenderer from '@/components/skill/SkillOutputRenderer';
import HtmlPreviewCard from '@/components/chat/artifacts/HtmlPreviewCard';
import DocumentCard from '@/components/chat/artifacts/DocumentCard';
import type { HtmlPreviewArtifact, DocumentArtifact } from '@/types/artifacts';

interface VersionEntry {
  skill_id: string;
  summary: string;
  completed_at: string;
}

export default function AssetsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const { skills, loading, refresh } = useSkillStatus(projectId);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [customNames, setCustomNames] = useState<Record<string, string>>({});
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [versions, setVersions] = useState<Record<string, VersionEntry[]>>({});
  const [showVersions, setShowVersions] = useState<string | null>(null);
  const [deletedSkills, setDeletedSkills] = useState<Set<string>>(new Set());

  // Load custom names from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(`asset-names-${projectId}`);
      if (stored) setCustomNames(JSON.parse(stored));
    } catch { /* ok */ }
  }, [projectId]);

  // Load version history from API
  useEffect(() => {
    async function fetchVersions() {
      try {
        const res = await fetch(`/api/projects/${projectId}/skills`);
        const json = await res.json();
        const rows: { skill_id: string; summary: string; completed_at: string }[] = json.data || [];
        const versionMap: Record<string, VersionEntry[]> = {};
        for (const row of rows) {
          // Versioned entries have _v suffix
          const match = row.skill_id.match(/^(.+?)_v(.+)$/);
          if (!match) continue;
          const baseSkillId = match[1];
          (versionMap[baseSkillId] ||= []).push(row);
        }
        // Sort versions by completed_at descending
        for (const key of Object.keys(versionMap)) {
          versionMap[key].sort((a, b) => b.completed_at.localeCompare(a.completed_at));
        }
        setVersions(versionMap);
      } catch { /* ok */ }
    }
    fetchVersions();
  }, [projectId]);

  const completedSkills = useMemo(() => {
    return STAGES.flatMap((stage) =>
      stage.skills
        .filter((s) => skills[s.id]?.status === 'completed' && skills[s.id]?.summary && !deletedSkills.has(s.id))
        .map((s) => ({ ...s, stage, data: skills[s.id] }))
    );
  }, [skills, deletedSkills]);

  function copyToClipboard(skillId: string, text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(skillId);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  function downloadMarkdown(filename: string, text: string) {
    const blob = new Blob([text], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadHtml(filename: string, content: string) {
    const segments = parseMessageContent(content);
    const htmlArtifact = segments
      .filter((s) => s.type === 'artifact')
      .map((s) => (s as { type: 'artifact'; artifact: { type: string; html?: string } }).artifact)
      .find((a) => a.type === 'html-preview' && a.html);
    if (!htmlArtifact?.html) return;
    const blob = new Blob([htmlArtifact.html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function startRename(skillId: string, currentLabel: string) {
    setRenamingId(skillId);
    setRenameValue(customNames[skillId] || currentLabel);
  }

  function saveRename(skillId: string) {
    const trimmed = renameValue.trim();
    if (trimmed) {
      const updated = { ...customNames, [skillId]: trimmed };
      setCustomNames(updated);
      try { localStorage.setItem(`asset-names-${projectId}`, JSON.stringify(updated)); } catch { /* ok */ }
    }
    setRenamingId(null);
  }

  function handleDelete(skillId: string) {
    if (!confirm('Remove this asset from the list?')) return;
    setDeletedSkills((prev) => new Set([...prev, skillId]));
    setExpanded(null);
  }

  function toggleSelect(skillId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(skillId)) next.delete(skillId);
      else next.add(skillId);
      return next;
    });
  }

  async function downloadPackage() {
    const { zipSync, strToU8 } = await import('fflate');
    const files: Record<string, Uint8Array> = {};
    const toc: string[] = ['# Asset Package\n'];

    for (const skill of completedSkills) {
      if (!selected.has(skill.id)) continue;
      const label = customNames[skill.id] || skill.label;
      const filename = label.replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-') + '.md';
      const content = skill.data.summary || '';
      files[filename] = strToU8(content);
      toc.push(`- [${label}](./${filename})`);
    }

    files['index.md'] = strToU8(toc.join('\n'));
    const zipData = zipSync(files, { level: 6 });
    const blob = new Blob([zipData], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `assets-package.zip`;
    a.click();
    URL.revokeObjectURL(url);
    setSelectMode(false);
    setSelected(new Set());
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-ink-5 text-sm">
        Loading assets...
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-ink">Generated Assets</h3>
            <p className="text-sm text-ink-4 mt-1">
              {completedSkills.length} document{completedSkills.length !== 1 ? 's' : ''} generated from your validation pipeline
            </p>
          </div>
          <div className="flex items-center gap-2">
            {selectMode && selected.size > 0 && (
              <button
                onClick={downloadPackage}
                className="text-xs px-3 py-1.5 bg-moss text-on-accent rounded font-medium hover:opacity-90 transition-opacity"
              >
                Download package ({selected.size})
              </button>
            )}
            <button
              onClick={() => { setSelectMode(!selectMode); setSelected(new Set()); }}
              className="text-xs px-3 py-1.5 bg-paper-2 hover:bg-paper-3 text-ink-4 hover:text-ink-2 rounded transition-colors"
            >
              {selectMode ? 'Cancel' : 'Select'}
            </button>
          </div>
        </div>

        {completedSkills.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-ink-6 text-3xl mb-3">-</div>
            <p className="text-sm text-ink-4 mb-1">No assets generated yet</p>
            <p className="text-xs text-ink-6">Run skills from the sidebar to generate documents</p>
          </div>
        ) : (
          <div className="space-y-3">
            {STAGES.map((stage) => {
              const stageSkills = completedSkills.filter((s) => s.stage.number === stage.number);
              if (stageSkills.length === 0) return null;

              return (
                <div key={stage.number}>
                  <div className="text-[10px] text-ink-5 uppercase tracking-wider mb-2 mt-4">
                    {stage.name}
                  </div>
                  <div className="space-y-2">
                    {stageSkills.map((skill) => {
                      const isExpanded = expanded === skill.id;
                      const preview = skill.data.summary?.replace(/:::artifact[\s\S]*?:::/g, '').slice(0, 200).trim();
                      const displayName = customNames[skill.id] || skill.label;
                      const skillVersions = versions[skill.id] || [];
                      const isShowingVersions = showVersions === skill.id;

                      return (
                        <div key={skill.id} className="bg-paper border border-line rounded-lg overflow-hidden">
                          {/* Card header */}
                          <div className="px-4 py-3 flex items-center gap-3">
                            {selectMode && (
                              <input
                                type="checkbox"
                                checked={selected.has(skill.id)}
                                onChange={() => toggleSelect(skill.id)}
                                className="shrink-0"
                              />
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                {renamingId === skill.id ? (
                                  <input
                                    autoFocus
                                    value={renameValue}
                                    onChange={(e) => setRenameValue(e.target.value)}
                                    onBlur={() => saveRename(skill.id)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') saveRename(skill.id);
                                      if (e.key === 'Escape') setRenamingId(null);
                                    }}
                                    className="text-sm font-medium text-ink-2 bg-paper-2 border border-line-2 rounded px-2 py-0.5"
                                    style={{ minWidth: 120 }}
                                  />
                                ) : (
                                  <span
                                    className="text-sm font-medium text-ink-2 cursor-pointer"
                                    onDoubleClick={() => startRename(skill.id, skill.label)}
                                    title="Double-click to rename"
                                  >
                                    {displayName}
                                  </span>
                                )}
                                <span className="text-xs px-2 py-0.5 rounded-full bg-moss/20 text-moss">Complete</span>
                                {skillVersions.length > 0 && (
                                  <button
                                    onClick={() => setShowVersions(isShowingVersions ? null : skill.id)}
                                    className="text-[10px] px-1.5 py-0.5 rounded bg-paper-2 hover:bg-paper-3 text-ink-5 hover:text-ink-3 transition-colors"
                                    title={`${skillVersions.length} previous version${skillVersions.length !== 1 ? 's' : ''}`}
                                  >
                                    {skillVersions.length} prev
                                  </button>
                                )}
                              </div>
                              {!isExpanded && preview && (
                                <p className="text-xs text-ink-5 mt-1 truncate">{preview}...</p>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {skill.data.completedAt && (
                                <span className="text-[10px] text-ink-6 mr-2">
                                  {new Date(skill.data.completedAt).toLocaleDateString()}
                                </span>
                              )}
                              <button
                                onClick={() => copyToClipboard(skill.id, skill.data.summary || '')}
                                className="text-xs px-2 py-1 bg-paper-2 hover:bg-paper-3 text-ink-4 hover:text-ink-2 rounded transition-colors"
                              >
                                {copied === skill.id ? 'Copied' : 'Copy'}
                              </button>
                              <button
                                onClick={() => downloadMarkdown(skill.id, skill.data.summary || '')}
                                className="text-xs px-2 py-1 bg-paper-2 hover:bg-paper-3 text-ink-4 hover:text-ink-2 rounded transition-colors"
                              >
                                Export .md
                              </button>
                              {skill.id.startsWith('build-landing') && (
                                <button
                                  onClick={() => downloadHtml(skill.id, skill.data.summary || '')}
                                  className="text-xs px-2 py-1 bg-paper-2 hover:bg-paper-3 text-ink-4 hover:text-ink-2 rounded transition-colors"
                                >
                                  Export HTML
                                </button>
                              )}
                              <button
                                onClick={() => openPrintPreview(skill.label, skill.data.summary || '')}
                                className="text-xs px-2 py-1 bg-paper-2 hover:bg-paper-3 text-ink-4 hover:text-ink-2 rounded transition-colors"
                              >
                                View PDF
                              </button>
                              <button
                                onClick={() => setExpanded(isExpanded ? null : skill.id)}
                                className="text-xs px-2 py-1 bg-paper-2 hover:bg-paper-3 text-ink-4 hover:text-ink-2 rounded transition-colors"
                              >
                                {isExpanded ? 'Collapse' : 'View'}
                              </button>
                              <button
                                onClick={() => handleDelete(skill.id)}
                                className="text-xs px-2 py-1 bg-paper-2 hover:bg-clay/20 text-ink-5 hover:text-clay rounded transition-colors"
                                title="Remove from list"
                              >
                                &times;
                              </button>
                            </div>
                          </div>

                          {/* Version history */}
                          {isShowingVersions && skillVersions.length > 0 && (
                            <div className="px-4 pb-3 border-t border-line">
                              <div className="text-[10px] text-ink-5 uppercase tracking-wider mt-2 mb-1">
                                Previous versions
                              </div>
                              {skillVersions.map((v, idx) => (
                                <div
                                  key={v.skill_id}
                                  className="flex items-center gap-3 py-1.5 border-b border-line last:border-0"
                                >
                                  <span className="text-[10px] text-ink-5 font-mono">
                                    v{skillVersions.length - idx}
                                  </span>
                                  <span className="text-xs text-ink-4 flex-1">
                                    {new Date(v.completed_at).toLocaleString()}
                                  </span>
                                  <button
                                    onClick={() => copyToClipboard(v.skill_id, v.summary)}
                                    className="text-[10px] px-2 py-0.5 bg-paper-2 hover:bg-paper-3 text-ink-4 rounded transition-colors"
                                  >
                                    Copy
                                  </button>
                                  <button
                                    onClick={() => downloadMarkdown(v.skill_id, v.summary)}
                                    className="text-[10px] px-2 py-0.5 bg-paper-2 hover:bg-paper-3 text-ink-4 rounded transition-colors"
                                  >
                                    Export
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Expanded content */}
                          {isExpanded && skill.data.summary && (
                            <div className="px-4 pb-4 border-t border-line">
                              <div className="mt-3 bg-surface-sunk rounded-lg p-4 max-h-[600px] overflow-y-auto">
                                <BuildArtifactOrFallback
                                  skillId={skill.id}
                                  content={skill.data.summary}
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * For build-* skills, extract the rich artifact and render via HtmlPreviewCard
 * or DocumentCard. Falls back to SkillOutputRenderer for non-build skills.
 */
function BuildArtifactOrFallback({ skillId, content }: { skillId: string; content: string }) {
  if (!skillId.startsWith('build-')) {
    return <SkillOutputRenderer content={content} />;
  }

  const segments = parseMessageContent(content);
  const artifacts = segments
    .filter((s) => s.type === 'artifact')
    .map((s) => (s as { type: 'artifact'; artifact: { type: string } }).artifact);

  const htmlPreview = artifacts.find((a) => a.type === 'html-preview') as HtmlPreviewArtifact | undefined;
  if (htmlPreview) {
    return <HtmlPreviewCard artifact={htmlPreview} />;
  }

  const doc = artifacts.find((a) => a.type === 'document') as DocumentArtifact | undefined;
  if (doc) {
    return <DocumentCard artifact={doc} />;
  }

  return <SkillOutputRenderer content={content} />;
}
