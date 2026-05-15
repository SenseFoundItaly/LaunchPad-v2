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
        return 'text-moss bg-moss/10';
      case 'testing':
        return 'text-accent bg-accent/10';
      case 'tested':
        return 'text-ink-3 bg-paper-3/50';
      case 'adopted':
        return 'text-moss bg-moss/10';
      case 'rejected':
        return 'text-clay bg-clay/10';
      default:
        return 'text-ink-4 bg-paper-2';
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-ink-5 text-sm">
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
            className="px-4 py-2 bg-moss hover:bg-moss text-white rounded-lg text-sm font-medium transition-colors"
          >
            + New Loop
          </button>
        </div>

        {/* Task Progress */}
        {isRunning && (
          <div className="bg-paper border border-line rounded-xl p-6 mb-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-4 h-4 border-2 border-moss border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-ink-3">
                {taskAction === 'experiment' ? 'Generating experiment...' : 'Synthesizing learnings...'}
                {task?.message && ` ${task.message}`}
              </span>
            </div>
            <div className="w-full h-2 bg-paper-2 rounded-full">
              <div
                className="h-full bg-moss rounded-full transition-all"
                style={{ width: `${task?.progress || 0}%` }}
              />
            </div>
          </div>
        )}

        {task?.status === 'failed' && (
          <div className="bg-clay/10 border border-clay/30 rounded-xl p-4 mb-6 text-clay text-sm">
            {task.error}
          </div>
        )}

        {/* New Loop Form */}
        {showNewLoop && (
          <div className="bg-paper border border-line rounded-xl p-6 mb-6">
            <h4 className="text-sm font-medium text-white mb-4">Create Growth Loop</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs text-ink-4 mb-1">Metric Name</label>
                <input
                  type="text"
                  value={loopForm.metric_name}
                  onChange={(e) => setLoopForm({ ...loopForm, metric_name: e.target.value })}
                  className="w-full bg-paper-2 border border-line-2 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-moss"
                  placeholder="e.g., Conversion Rate"
                />
              </div>
              <div>
                <label className="block text-xs text-ink-4 mb-1">Optimization Target</label>
                <select
                  value={loopForm.optimization_target}
                  onChange={(e) => setLoopForm({ ...loopForm, optimization_target: e.target.value })}
                  className="w-full bg-paper-2 border border-line-2 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-moss"
                >
                  {OPTIMIZATION_TARGETS.map((t) => (
                    <option key={t} value={t}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-ink-4 mb-1">Baseline Value</label>
                <input
                  type="number"
                  value={loopForm.baseline_value}
                  onChange={(e) => setLoopForm({ ...loopForm, baseline_value: Number(e.target.value) })}
                  className="w-full bg-paper-2 border border-line-2 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-moss"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setShowNewLoop(false)}
                className="px-4 py-2 text-sm text-ink-4 hover:text-ink-2 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={createLoop}
                disabled={!loopForm.metric_name}
                className="px-4 py-2 bg-moss hover:bg-moss disabled:bg-paper-3 text-white rounded-lg text-sm font-medium transition-colors"
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
              className="text-sm text-moss hover:text-moss/70 mb-4 flex items-center gap-1 transition-colors"
            >
              &larr; Back to all loops
            </button>

            <div className="bg-paper border border-line rounded-xl p-6 mb-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h4 className="text-white font-medium">{activeLoop.metric_name}</h4>
                  <p className="text-xs text-ink-4 mt-1">
                    Target: {activeLoop.optimization_target} | Status: {activeLoop.status}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => synthesizeLearnings(activeLoop.loop_id)}
                    disabled={isRunning}
                    className="px-3 py-1.5 bg-paper-2 hover:bg-paper-3 disabled:bg-paper-2 text-ink-3 rounded-lg text-sm transition-colors"
                  >
                    Synthesize Learnings
                  </button>
                  <button
                    onClick={() => generateExperiment(activeLoop.loop_id)}
                    disabled={isRunning}
                    className="px-3 py-1.5 bg-moss hover:bg-moss disabled:bg-paper-3 text-white rounded-lg text-sm transition-colors"
                  >
                    Generate Next Experiment
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="bg-paper-2/50 rounded-lg p-3">
                  <div className="text-xs text-ink-4 mb-1">Baseline</div>
                  <div className="text-lg font-semibold text-white">{activeLoop.baseline_value}</div>
                </div>
                <div className="bg-paper-2/50 rounded-lg p-3">
                  <div className="text-xs text-ink-4 mb-1">Current Best</div>
                  <div className="text-lg font-semibold text-moss">
                    {activeLoop.current_best_value}
                  </div>
                </div>
              </div>

              {activeLoop.accumulated_learnings && (
                <div className="bg-moss/10 border border-moss/30 rounded-lg p-4 mb-4">
                  <h5 className="text-xs font-medium text-moss mb-1">Accumulated Learnings</h5>
                  <p className="text-sm text-ink-3 whitespace-pre-wrap">
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
                  className="bg-paper border border-line rounded-xl p-4"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(iter.status)}`}
                      >
                        {iter.status}
                      </span>
                      <span className="text-xs text-ink-5">{iter.created_at}</span>
                    </div>
                    {iter.improvement_pct !== null && (
                      <span
                        className={`text-sm font-medium ${
                          iter.improvement_pct >= 0 ? 'text-moss' : 'text-clay'
                        }`}
                      >
                        {iter.improvement_pct >= 0 ? '+' : ''}
                        {iter.improvement_pct}%
                      </span>
                    )}
                  </div>

                  <p className="text-sm text-ink-2 mb-3">{iter.hypothesis}</p>

                  {/* Proposed Changes */}
                  {iter.proposed_changes && iter.proposed_changes.length > 0 && (
                    <div className="space-y-2 mb-3">
                      {iter.proposed_changes.map((change, i) => (
                        <div key={i} className="grid grid-cols-3 gap-2 text-xs">
                          <div className="text-ink-4 font-medium">{change.element}</div>
                          <div className="bg-clay/10 text-clay rounded px-2 py-1">
                            {change.current}
                          </div>
                          <div className="bg-moss/10 text-moss rounded px-2 py-1">
                            {change.proposed}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {iter.learnings && (
                    <p className="text-xs text-ink-4 mt-2">Learnings: {iter.learnings}</p>
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
                      className="mt-3 px-3 py-1.5 bg-paper-2 hover:bg-paper-3 text-ink-3 rounded-lg text-xs transition-colors"
                    >
                      Log Result
                    </button>
                  )}

                  {/* Result Form */}
                  {resultForm && resultForm.iterationId === iter.iteration_id && (
                    <div className="mt-3 bg-paper-2/50 rounded-lg p-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs text-ink-4 mb-1">Result Value</label>
                          <input
                            type="number"
                            value={resultForm.result_value}
                            onChange={(e) =>
                              setResultForm({ ...resultForm, result_value: Number(e.target.value) })
                            }
                            className="w-full bg-paper-2 border border-line-2 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-moss"
                          />
                        </div>
                        <div className="flex items-end gap-3">
                          <label className="flex items-center gap-2 text-sm text-ink-3">
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
                          className="px-3 py-1.5 text-xs text-ink-4 hover:text-ink-2 transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={logResult}
                          className="px-3 py-1.5 bg-moss hover:bg-moss text-white rounded-lg text-xs font-medium transition-colors"
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
              <div className="text-center py-12 text-ink-5 text-sm">
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
                    className="w-full text-left bg-paper border border-line rounded-xl p-4 hover:border-line-2 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-white font-medium">{loop.metric_name}</h4>
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          loop.status === 'active'
                            ? 'text-moss bg-moss/10'
                            : loop.status === 'paused'
                              ? 'text-accent bg-accent/10'
                              : 'text-ink-4 bg-paper-2'
                        }`}
                      >
                        {loop.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-6 text-sm">
                      <span className="text-ink-4">
                        Target: <span className="text-ink-2">{loop.optimization_target}</span>
                      </span>
                      <span className="text-ink-4">
                        Baseline: <span className="text-ink-2">{loop.baseline_value}</span>
                      </span>
                      <span className="text-ink-4">
                        Best:{' '}
                        <span className="text-moss">{loop.current_best_value}</span>
                      </span>
                      <span className="text-ink-4">
                        Iterations:{' '}
                        <span className="text-ink-2">{(loop.iterations || []).length}</span>
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-center py-20 text-ink-5">
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
