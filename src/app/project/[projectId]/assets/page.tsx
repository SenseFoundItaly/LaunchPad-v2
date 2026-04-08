'use client';

import { use, useState } from 'react';
import { STAGES } from '@/lib/stages';
import { useSkillStatus } from '@/hooks/useSkillStatus';
import { openPrintPreview } from '@/lib/print-utils';
import SkillOutputRenderer from '@/components/skill/SkillOutputRenderer';

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
      <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
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

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-white">Generated Assets</h3>
          <p className="text-sm text-zinc-400 mt-1">
            {completedSkills.length} document{completedSkills.length !== 1 ? 's' : ''} generated from your validation pipeline
          </p>
        </div>

        {completedSkills.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-zinc-600 text-3xl mb-3">-</div>
            <p className="text-sm text-zinc-400 mb-1">No assets generated yet</p>
            <p className="text-xs text-zinc-600">Run skills from the sidebar to generate documents</p>
          </div>
        ) : (
          <div className="space-y-3">
            {STAGES.map((stage) => {
              const stageSkills = completedSkills.filter((s) => s.stage.number === stage.number);
              if (stageSkills.length === 0) return null;

              return (
                <div key={stage.number}>
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2 mt-4">
                    {stage.name}
                  </div>
                  <div className="space-y-2">
                    {stageSkills.map((skill) => {
                      const isExpanded = expanded === skill.id;
                      const preview = skill.data.summary?.replace(/:::artifact[\s\S]*?:::/g, '').slice(0, 200).trim();

                      return (
                        <div key={skill.id} className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
                          {/* Card header */}
                          <div className="px-4 py-3 flex items-center gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-zinc-200">{skill.label}</span>
                                <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400">Complete</span>
                              </div>
                              {!isExpanded && preview && (
                                <p className="text-xs text-zinc-500 mt-1 truncate">{preview}...</p>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {skill.data.completedAt && (
                                <span className="text-[10px] text-zinc-600 mr-2">
                                  {new Date(skill.data.completedAt).toLocaleDateString()}
                                </span>
                              )}
                              <button
                                onClick={() => copyToClipboard(skill.id, skill.data.summary || '')}
                                className="text-xs px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 rounded transition-colors"
                              >
                                {copied === skill.id ? 'Copied' : 'Copy'}
                              </button>
                              <button
                                onClick={() => downloadMarkdown(skill.id, skill.data.summary || '')}
                                className="text-xs px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 rounded transition-colors"
                              >
                                Export .md
                              </button>
                              <button
                                onClick={() => openPrintPreview(skill.label, skill.data.summary || '')}
                                className="text-xs px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 rounded transition-colors"
                              >
                                View PDF
                              </button>
                              <button
                                onClick={() => setExpanded(isExpanded ? null : skill.id)}
                                className="text-xs px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 rounded transition-colors"
                              >
                                {isExpanded ? 'Collapse' : 'View'}
                              </button>
                            </div>
                          </div>

                          {/* Expanded content */}
                          {isExpanded && skill.data.summary && (
                            <div className="px-4 pb-4 border-t border-zinc-800">
                              <div className="mt-3 bg-zinc-950 rounded-lg p-4 max-h-[600px] overflow-y-auto">
                                <SkillOutputRenderer content={skill.data.summary} />
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
