'use client';

import { use, useState } from 'react';
import { STAGES } from '@/lib/stages';
import { useSkillStatus } from '@/hooks/useSkillStatus';
import { openPrintPreview } from '@/lib/print-utils';
import { parseMessageContent } from '@/lib/artifact-parser';
import SkillOutputRenderer from '@/components/skill/SkillOutputRenderer';
import HtmlPreviewCard from '@/components/chat/artifacts/HtmlPreviewCard';
import DocumentCard from '@/components/chat/artifacts/DocumentCard';
import type { HtmlPreviewArtifact, DocumentArtifact } from '@/types/artifacts';

export default function AssetsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const { skills, loading } = useSkillStatus(projectId);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-ink-5 text-sm">
        Loading assets...
      </div>
    );
  }

  const completedSkills = STAGES.flatMap((stage) =>
    stage.skills
      .filter((s) => skills[s.id]?.status === 'completed' && skills[s.id]?.summary)
      .map((s) => ({ ...s, stage, data: skills[s.id] }))
  );

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
    // Extract HTML from html-preview artifact in content
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

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-white">Generated Assets</h3>
          <p className="text-sm text-ink-4 mt-1">
            {completedSkills.length} document{completedSkills.length !== 1 ? 's' : ''} generated from your validation pipeline
          </p>
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

                      return (
                        <div key={skill.id} className="bg-paper border border-line rounded-lg overflow-hidden">
                          {/* Card header */}
                          <div className="px-4 py-3 flex items-center gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-ink-2">{skill.label}</span>
                                <span className="text-xs px-2 py-0.5 rounded-full bg-moss/20 text-moss">Complete</span>
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
                            </div>
                          </div>

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
