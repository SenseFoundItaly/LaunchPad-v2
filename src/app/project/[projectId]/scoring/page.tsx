'use client';

import { use, useEffect, useState } from 'react';
import api from '@/api';
import { getStepData } from '@/api/projects';
import { useTaskPolling } from '@/hooks/useTaskPolling';
import RadarChart from '@/components/charts/RadarChart';
import ScoreCard from '@/components/charts/ScoreCard';
import type { ScoreResult } from '@/types';

export default function ScoringPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const [scores, setScores] = useState<ScoreResult | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { task } = useTaskPolling(taskId);

  useEffect(() => {
    getStepData<ScoreResult>(projectId, 'scores').then((data) => {
      if (data) {setScores(data);}
      setLoading(false);
    });
  }, [projectId]);

  useEffect(() => {
    if (task?.status === 'completed' && task.result) {
      setScores(task.result as unknown as ScoreResult);
      setTaskId(null);
    }
  }, [task]);

  async function runScoring() {
    setTaskId(null);
    const { data } = await api.post('/api/scoring/run', { project_id: projectId });
    if (data.success) {setTaskId(data.data.task_id);}
  }

  const isRunning = task?.status === 'processing' || task?.status === 'pending';

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-white">Startup Scoring</h3>
          <button
            onClick={runScoring}
            disabled={isRunning}
            className="px-4 py-2 bg-moss hover:bg-moss disabled:bg-paper-3 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {isRunning ? `Scoring... ${task?.progress || 0}%` : scores ? 'Re-score' : 'Run Scoring'}
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

        {scores && (
          <>
            <div className="bg-paper border border-line rounded-xl p-6 mb-6 flex flex-col items-center">
              <div className="text-4xl font-bold text-white mb-1">{scores.overall_score}</div>
              <div className="text-sm text-ink-4 mb-6">Overall Score</div>
              <RadarChart dimensions={scores.dimensions} size={350} />
            </div>

            {scores.top_recommendation && (
              <div className="bg-moss/10 border border-moss/30 rounded-xl p-4 mb-6">
                <h4 className="text-sm font-medium text-moss mb-1">Top Recommendation</h4>
                <p className="text-sm text-ink-3">{scores.top_recommendation}</p>
              </div>
            )}

            {scores.benchmark_comparison && (
              <div className="bg-paper border border-line rounded-xl p-4 mb-6">
                <h4 className="text-sm font-medium text-ink-4 mb-1">Benchmark</h4>
                <p className="text-sm text-ink-3">{scores.benchmark_comparison}</p>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {scores.dimensions.map((dim) => (
                <ScoreCard key={dim.name} dimension={dim} />
              ))}
            </div>
          </>
        )}

        {!scores && !isRunning && !loading && (
          <div className="text-center py-20 text-ink-5">
            <p>Run scoring to evaluate your startup idea across 6 dimensions.</p>
            <p className="text-sm mt-1">Make sure you&apos;ve completed the Idea Canvas first.</p>
          </div>
        )}
      </div>
    </div>
  );
}
