'use client';

import { use, useEffect, useState, useCallback } from 'react';
import api from '@/api';
import { useTaskPolling } from '@/hooks/useTaskPolling';
import type { GrowthLoop, GrowthIteration, ApiResponse } from '@/types';

const OPTIMIZATION_TARGETS = ['messaging', 'pricing', 'positioning', 'funnel', 'outreach'];

export default function GrowthPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);

  const [loops, setLoops] = useState<GrowthLoop[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLoop, setSelectedLoop] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [taskAction, setTaskAction] = useState<string | null>(null);
  const { task } = useTaskPolling(taskId);

  // Forms
  const [showNewLoop, setShowNewLoop] = useState(false);
  const [loopForm, setLoopForm] = useState({
    metric_name: '',
    optimization_target: 'messaging',
    baseline_value: 0,
  });
  const [resultForm, setResultForm] = useState<{
    iterationId: string;
    loopId: string;
    result_value: number;
    adopted: boolean;
  } | null>(null);

  const fetchLoops = useCallback(async () => {
    try {
      const { data } = await api.get<ApiResponse<GrowthLoop[]>>(
        `/api/growth/${projectId}/loops`
      );
      if (data.data) {setLoops(data.data);}
    } catch {
      // No loops yet
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchLoops();
  }, [fetchLoops]);

  useEffect(() => {
    if (task?.status === 'completed') {
      fetchLoops();
      setTaskId(null);
      setTaskAction(null);
    }
  }, [task, fetchLoops]);

  async function createLoop() {
    try {
      await api.post(`/api/growth/${projectId}/loops`, loopForm);
      setShowNewLoop(false);
      setLoopForm({ metric_name: '', optimization_target: 'messaging', baseline_value: 0 });
      fetchLoops();
    } catch (err) {
      console.error('Failed to create loop:', err);
    }
  }

  async function generateExperiment(loopId: string) {
    setTaskId(null);
    setTaskAction('experiment');
    try {
      const { data } = await api.post<ApiResponse<{ task_id: string }>>(
        `/api/growth/${projectId}/loops/${loopId}/generate`
      );
      if (data.success) {setTaskId(data.data.task_id);}
    } catch (err) {
      console.error('Failed to generate experiment:', err);
    }
  }

  async function logResult() {
    if (!resultForm) {return;}
    try {
      await api.post(
        `/api/growth/${projectId}/loops/${resultForm.loopId}/iterations/${resultForm.iterationId}/result`,
        { result_value: resultForm.result_value, adopted: resultForm.adopted }
      );
      setResultForm(null);
      fetchLoops();
    } catch (err) {
      console.error('Failed to log result:', err);
    }
  }

  async function synthesizeLearnings(loopId: string) {
    setTaskId(null);
    setTaskAction('synthesize');
    try {
      const { data } = await api.post<ApiResponse<{ task_id: string }>>(
        `/api/growth/${projectId}/loops/${loopId}/synthesize`
      );
      if (data.success) {setTaskId(data.data.task_id);}
    } catch (err) {
      console.error('Failed to synthesize:', err);
    }
  }

  const isRunning = task?.status === 'processing' || task?.status === 'pending';
  const activeLoop = loops.find((l) => l.loop_id === selectedLoop);

  function statusColor(status: GrowthIteration['status']) {
    switch (status) {
      case 'proposed':
        return 'text-blue-400 bg-blue-500/10';
      case 'testing':
        return 'text-yellow-400 bg-yellow-500/10';
      case 'tested':
        return 'text-zinc-300 bg-zinc-700/50';
      case 'adopted':
        return 'text-green-400 bg-green-500/10';
      case 'rejected':
        return 'text-red-400 bg-red-500/10';
      default:
        return 'text-zinc-400 bg-zinc-800';
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
        Loading growth loops...
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-white">Growth Intelligence</h3>
          <button
            onClick={() => setShowNewLoop(!showNewLoop)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
          >
            + New Loop
          </button>
        </div>

        {/* Task Progress */}
        {isRunning && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-zinc-300">
                {taskAction === 'experiment' ? 'Generating experiment...' : 'Synthesizing learnings...'}
                {task?.message && ` ${task.message}`}
              </span>
            </div>
            <div className="w-full h-2 bg-zinc-800 rounded-full">
              <div
                className="h-full bg-blue-500 rounded-full transition-all"
                style={{ width: `${task?.progress || 0}%` }}
              />
            </div>
          </div>
        )}

        {task?.status === 'failed' && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-6 text-red-400 text-sm">
            {task.error}
          </div>
        )}

        {/* New Loop Form */}
        {showNewLoop && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-6">
            <h4 className="text-sm font-medium text-white mb-4">Create Growth Loop</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Metric Name</label>
                <input
                  type="text"
                  value={loopForm.metric_name}
                  onChange={(e) => setLoopForm({ ...loopForm, metric_name: e.target.value })}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                  placeholder="e.g., Conversion Rate"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Optimization Target</label>
                <select
                  value={loopForm.optimization_target}
                  onChange={(e) => setLoopForm({ ...loopForm, optimization_target: e.target.value })}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                >
                  {OPTIMIZATION_TARGETS.map((t) => (
                    <option key={t} value={t}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Baseline Value</label>
                <input
                  type="number"
                  value={loopForm.baseline_value}
                  onChange={(e) => setLoopForm({ ...loopForm, baseline_value: Number(e.target.value) })}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setShowNewLoop(false)}
                className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={createLoop}
                disabled={!loopForm.metric_name}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white rounded-lg text-sm font-medium transition-colors"
              >
                Create Loop
              </button>
            </div>
          </div>
        )}

        {/* Loop Detail View */}
        {activeLoop ? (
          <div>
            <button
              onClick={() => setSelectedLoop(null)}
              className="text-sm text-blue-400 hover:text-blue-300 mb-4 flex items-center gap-1 transition-colors"
            >
              &larr; Back to all loops
            </button>

            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h4 className="text-white font-medium">{activeLoop.metric_name}</h4>
                  <p className="text-xs text-zinc-400 mt-1">
                    Target: {activeLoop.optimization_target} | Status: {activeLoop.status}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => synthesizeLearnings(activeLoop.loop_id)}
                    disabled={isRunning}
                    className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-800 text-zinc-300 rounded-lg text-sm transition-colors"
                  >
                    Synthesize Learnings
                  </button>
                  <button
                    onClick={() => generateExperiment(activeLoop.loop_id)}
                    disabled={isRunning}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white rounded-lg text-sm transition-colors"
                  >
                    Generate Next Experiment
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="bg-zinc-800/50 rounded-lg p-3">
                  <div className="text-xs text-zinc-400 mb-1">Baseline</div>
                  <div className="text-lg font-semibold text-white">{activeLoop.baseline_value}</div>
                </div>
                <div className="bg-zinc-800/50 rounded-lg p-3">
                  <div className="text-xs text-zinc-400 mb-1">Current Best</div>
                  <div className="text-lg font-semibold text-green-400">
                    {activeLoop.current_best_value}
                  </div>
                </div>
              </div>

              {activeLoop.accumulated_learnings && (
                <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mb-4">
                  <h5 className="text-xs font-medium text-blue-400 mb-1">Accumulated Learnings</h5>
                  <p className="text-sm text-zinc-300 whitespace-pre-wrap">
                    {activeLoop.accumulated_learnings}
                  </p>
                </div>
              )}
            </div>

            {/* Iterations Timeline */}
            <h4 className="text-sm font-medium text-white mb-4">Iteration Timeline</h4>
            <div className="space-y-4">
              {(activeLoop.iterations || []).map((iter) => (
                <div
                  key={iter.iteration_id}
                  className="bg-zinc-900 border border-zinc-800 rounded-xl p-4"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(iter.status)}`}
                      >
                        {iter.status}
                      </span>
                      <span className="text-xs text-zinc-500">{iter.created_at}</span>
                    </div>
                    {iter.improvement_pct !== null && (
                      <span
                        className={`text-sm font-medium ${
                          iter.improvement_pct >= 0 ? 'text-green-400' : 'text-red-400'
                        }`}
                      >
                        {iter.improvement_pct >= 0 ? '+' : ''}
                        {iter.improvement_pct}%
                      </span>
                    )}
                  </div>

                  <p className="text-sm text-zinc-200 mb-3">{iter.hypothesis}</p>

                  {/* Proposed Changes */}
                  {iter.proposed_changes && iter.proposed_changes.length > 0 && (
                    <div className="space-y-2 mb-3">
                      {iter.proposed_changes.map((change, i) => (
                        <div key={i} className="grid grid-cols-3 gap-2 text-xs">
                          <div className="text-zinc-400 font-medium">{change.element}</div>
                          <div className="bg-red-500/10 text-red-300 rounded px-2 py-1">
                            {change.current}
                          </div>
                          <div className="bg-green-500/10 text-green-300 rounded px-2 py-1">
                            {change.proposed}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {iter.learnings && (
                    <p className="text-xs text-zinc-400 mt-2">Learnings: {iter.learnings}</p>
                  )}

                  {/* Log Result Button */}
                  {iter.status === 'proposed' && (
                    <button
                      onClick={() =>
                        setResultForm({
                          iterationId: iter.iteration_id,
                          loopId: activeLoop.loop_id,
                          result_value: 0,
                          adopted: false,
                        })
                      }
                      className="mt-3 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs transition-colors"
                    >
                      Log Result
                    </button>
                  )}

                  {/* Result Form */}
                  {resultForm && resultForm.iterationId === iter.iteration_id && (
                    <div className="mt-3 bg-zinc-800/50 rounded-lg p-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs text-zinc-400 mb-1">Result Value</label>
                          <input
                            type="number"
                            value={resultForm.result_value}
                            onChange={(e) =>
                              setResultForm({ ...resultForm, result_value: Number(e.target.value) })
                            }
                            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                          />
                        </div>
                        <div className="flex items-end gap-3">
                          <label className="flex items-center gap-2 text-sm text-zinc-300">
                            <input
                              type="checkbox"
                              checked={resultForm.adopted}
                              onChange={(e) =>
                                setResultForm({ ...resultForm, adopted: e.target.checked })
                              }
                              className="rounded"
                            />
                            Adopt this change
                          </label>
                        </div>
                      </div>
                      <div className="flex justify-end gap-2 mt-3">
                        <button
                          onClick={() => setResultForm(null)}
                          className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={logResult}
                          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium transition-colors"
                        >
                          Save Result
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {(activeLoop.iterations || []).length === 0 && (
              <div className="text-center py-12 text-zinc-500 text-sm">
                No iterations yet. Click &quot;Generate Next Experiment&quot; to start.
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Loops List */}
            {loops.length > 0 ? (
              <div className="space-y-4">
                {loops.map((loop) => (
                  <button
                    key={loop.loop_id}
                    onClick={() => setSelectedLoop(loop.loop_id)}
                    className="w-full text-left bg-zinc-900 border border-zinc-800 rounded-xl p-4 hover:border-zinc-700 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-white font-medium">{loop.metric_name}</h4>
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          loop.status === 'active'
                            ? 'text-green-400 bg-green-500/10'
                            : loop.status === 'paused'
                              ? 'text-yellow-400 bg-yellow-500/10'
                              : 'text-zinc-400 bg-zinc-800'
                        }`}
                      >
                        {loop.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-6 text-sm">
                      <span className="text-zinc-400">
                        Target: <span className="text-zinc-200">{loop.optimization_target}</span>
                      </span>
                      <span className="text-zinc-400">
                        Baseline: <span className="text-zinc-200">{loop.baseline_value}</span>
                      </span>
                      <span className="text-zinc-400">
                        Best:{' '}
                        <span className="text-green-400">{loop.current_best_value}</span>
                      </span>
                      <span className="text-zinc-400">
                        Iterations:{' '}
                        <span className="text-zinc-200">{(loop.iterations || []).length}</span>
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-center py-20 text-zinc-500">
                <p>No growth loops yet.</p>
                <p className="text-sm mt-1">
                  Create a loop to start running AI-powered growth experiments.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
