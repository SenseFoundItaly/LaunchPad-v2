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
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {isRunning ? `Researching... ${task?.progress || 0}%` : research ? 'Re-research' : 'Run Research'}
          </button>
        </div>

        {isRunning && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-zinc-300">{task?.message || 'Processing...'}</span>
            </div>
            <div className="w-full h-2 bg-zinc-800 rounded-full">
              <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${task?.progress || 0}%` }} />
            </div>
          </div>
        )}

        {task?.status === 'failed' && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-6 text-red-400 text-sm">
            {task.error}
          </div>
        )}

        {research && (
          <>
            {/* Market Size */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-6">
              <h4 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-4">Market Size</h4>
              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: 'TAM', value: research.market_size.tam, color: 'blue' },
                  { label: 'SAM', value: research.market_size.sam, color: 'cyan' },
                  { label: 'SOM', value: research.market_size.som, color: 'green' },
                ].map(({ label, value, color }) => (
                  <div key={label} className={`bg-${color}-500/10 border border-${color}-500/20 rounded-lg p-4`}>
                    <div className={`text-xs font-medium text-${color}-400 mb-1`}>{label}</div>
                    <div className="text-sm text-zinc-200">{value}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Competitors */}
            <h4 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Competitors</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              {research.competitors.map((comp) => (
                <div key={comp.name} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                  <h5 className="text-white font-medium mb-1">{comp.name}</h5>
                  <p className="text-zinc-400 text-xs mb-3">{comp.description}</p>
                  {comp.strengths.length > 0 && (
                    <div className="mb-2">
                      <span className="text-xs text-green-400">Strengths: </span>
                      <span className="text-xs text-zinc-400">{comp.strengths.join(', ')}</span>
                    </div>
                  )}
                  {comp.weaknesses.length > 0 && (
                    <div className="mb-2">
                      <span className="text-xs text-red-400">Weaknesses: </span>
                      <span className="text-xs text-zinc-400">{comp.weaknesses.join(', ')}</span>
                    </div>
                  )}
                  {comp.funding && (
                    <div className="text-xs text-zinc-500">Funding: {comp.funding}</div>
                  )}
                </div>
              ))}
            </div>

            {/* Trends */}
            <h4 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Trends</h4>
            <div className="space-y-3 mb-6">
              {research.trends.map((trend) => (
                <div key={trend.title} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-1">
                    <h5 className="text-white font-medium text-sm">{trend.title}</h5>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      trend.direction === 'growing' ? 'bg-green-500/20 text-green-400' :
                      trend.direction === 'declining' ? 'bg-red-500/20 text-red-400' :
                      'bg-zinc-500/20 text-zinc-400'
                    }`}>{trend.direction}</span>
                  </div>
                  <p className="text-xs text-zinc-400">{trend.description}</p>
                  <p className="text-xs text-blue-400 mt-1">Relevance: {trend.relevance}</p>
                </div>
              ))}
            </div>

            {/* Key Insights */}
            {research.key_insights && research.key_insights.length > 0 && (
              <>
                <h4 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Key Insights</h4>
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 mb-6">
                  <ul className="space-y-2">
                    {research.key_insights.map((insight, i) => (
                      <li key={i} className="text-sm text-zinc-200 flex gap-2">
                        <span className="text-blue-400 shrink-0">{i + 1}.</span>
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
          <div className="text-center py-20 text-zinc-500">
            <p>Run market research to analyze your startup&apos;s competitive landscape.</p>
          </div>
        )}
      </div>
    </div>
  );
}
