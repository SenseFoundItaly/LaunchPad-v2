'use client';

import { use, useEffect, useState } from 'react';
import api from '@/api';
import { getStepData } from '@/api/projects';
import { useTaskPolling } from '@/hooks/useTaskPolling';
import type { ResearchResult } from '@/types';

export default function ResearchPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const [research, setResearch] = useState<ResearchResult | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { task } = useTaskPolling(taskId);

  useEffect(() => {
    getStepData<ResearchResult>(projectId, 'research').then((data) => {
      if (data) {setResearch(data);}
      setLoading(false);
    });
  }, [projectId]);

  useEffect(() => {
    if (task?.status === 'completed' && task.result) {
      setResearch(task.result as unknown as ResearchResult);
      setTaskId(null);
    }
  }, [task]);

  async function runResearch() {
    setTaskId(null);
    const { data } = await api.post('/api/research/run', { project_id: projectId });
    if (data.success) {setTaskId(data.data.task_id);}
  }

  const isRunning = task?.status === 'processing' || task?.status === 'pending';

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-white">Market Research</h3>
          <button
            onClick={runResearch}
            disabled={isRunning}
            className="px-4 py-2 bg-moss hover:bg-moss disabled:bg-paper-3 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {isRunning ? `Researching... ${task?.progress || 0}%` : research ? 'Re-research' : 'Run Research'}
          </button>
        </div>

        {isRunning && (
          <div className="bg-paper border border-line rounded-xl p-6 mb-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-4 h-4 border-2 border-moss border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-ink-3">{task?.message || 'Processing...'}</span>
            </div>
            <div className="w-full h-2 bg-paper-2 rounded-full">
              <div className="h-full bg-moss rounded-full transition-all" style={{ width: `${task?.progress || 0}%` }} />
            </div>
          </div>
        )}

        {task?.status === 'failed' && (
          <div className="bg-clay/10 border border-clay/30 rounded-xl p-4 mb-6 text-clay text-sm">
            {task.error}
          </div>
        )}

        {research && (
          <>
            {/* Market Size */}
            <div className="bg-paper border border-line rounded-xl p-6 mb-6">
              <h4 className="text-sm font-medium text-ink-4 uppercase tracking-wider mb-4">Market Size</h4>
              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: 'TAM', value: research.market_size.tam, color: 'blue' },
                  { label: 'SAM', value: research.market_size.sam, color: 'cyan' },
                  { label: 'SOM', value: research.market_size.som, color: 'green' },
                ].map(({ label, value, color }) => (
                  <div key={label} className={`bg-${color}-500/10 border border-${color}-500/20 rounded-lg p-4`}>
                    <div className={`text-xs font-medium text-${color}-400 mb-1`}>{label}</div>
                    <div className="text-sm text-ink-2">{value}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Competitors */}
            <h4 className="text-sm font-medium text-ink-4 uppercase tracking-wider mb-3">Competitors</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              {research.competitors.map((comp) => (
                <div key={comp.name} className="bg-paper border border-line rounded-xl p-4">
                  <h5 className="text-white font-medium mb-1">{comp.name}</h5>
                  <p className="text-ink-4 text-xs mb-3">{comp.description}</p>
                  {comp.strengths.length > 0 && (
                    <div className="mb-2">
                      <span className="text-xs text-moss">Strengths: </span>
                      <span className="text-xs text-ink-4">{comp.strengths.join(', ')}</span>
                    </div>
                  )}
                  {comp.weaknesses.length > 0 && (
                    <div className="mb-2">
                      <span className="text-xs text-clay">Weaknesses: </span>
                      <span className="text-xs text-ink-4">{comp.weaknesses.join(', ')}</span>
                    </div>
                  )}
                  {comp.funding && (
                    <div className="text-xs text-ink-5">Funding: {comp.funding}</div>
                  )}
                </div>
              ))}
            </div>

            {/* Trends */}
            <h4 className="text-sm font-medium text-ink-4 uppercase tracking-wider mb-3">Trends</h4>
            <div className="space-y-3 mb-6">
              {research.trends.map((trend) => (
                <div key={trend.title} className="bg-paper border border-line rounded-xl p-4">
                  <div className="flex items-center justify-between mb-1">
                    <h5 className="text-white font-medium text-sm">{trend.title}</h5>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      trend.direction === 'growing' ? 'bg-moss/20 text-moss' :
                      trend.direction === 'declining' ? 'bg-clay/20 text-clay' :
                      'bg-ink-5/20 text-ink-4'
                    }`}>{trend.direction}</span>
                  </div>
                  <p className="text-xs text-ink-4">{trend.description}</p>
                  <p className="text-xs text-moss mt-1">Relevance: {trend.relevance}</p>
                </div>
              ))}
            </div>

            {/* Key Insights */}
            {research.key_insights && research.key_insights.length > 0 && (
              <>
                <h4 className="text-sm font-medium text-ink-4 uppercase tracking-wider mb-3">Key Insights</h4>
                <div className="bg-moss/10 border border-moss/20 rounded-xl p-4 mb-6">
                  <ul className="space-y-2">
                    {research.key_insights.map((insight, i) => (
                      <li key={i} className="text-sm text-ink-2 flex gap-2">
                        <span className="text-moss shrink-0">{i + 1}.</span>
                        {insight}
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </>
        )}

        {!research && !isRunning && !loading && (
          <div className="text-center py-20 text-ink-5">
            <p>Run market research to analyze your startup&apos;s competitive landscape.</p>
          </div>
        )}
      </div>
    </div>
  );
}
