'use client';

import { use, useEffect, useState, useCallback } from 'react';
import api from '@/api';
import { useTaskPolling } from '@/hooks/useTaskPolling';
import type {
  StageInfo,
  Milestone,
  StartupUpdate,
  ScalingPlan,
  JourneyData,
  ApiResponse,
} from '@/types';

const STAGES = ['idea', 'mvp', 'pmf', 'growth', 'scale'] as const;
const STAGE_LABELS: Record<string, string> = {
  idea: 'Idea',
  mvp: 'MVP',
  pmf: 'PMF',
  growth: 'Growth',
  scale: 'Scale',
};

type Tab = 'timeline' | 'updates' | 'scaling';

export default function JourneyPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);

  const [activeTab, setActiveTab] = useState<Tab>('timeline');
  const [stageInfo, setStageInfo] = useState<StageInfo | null>(null);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [updates, setUpdates] = useState<StartupUpdate[]>([]);
  const [scalingPlan, setScalingPlan] = useState<ScalingPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [taskId, setTaskId] = useState<string | null>(null);
  const { task } = useTaskPolling(taskId);

  // Forms
  const [showUpdateForm, setShowUpdateForm] = useState(false);
  const [updateForm, setUpdateForm] = useState({
    period: '',
    highlights: '',
    challenges: '',
    asks: '',
    morale: 7,
  });

  const fetchData = useCallback(async () => {
    try {
      const { data } = await api.get<ApiResponse<JourneyData>>(`/api/journey/${projectId}`);
      if (data.data) {
        setStageInfo(data.data.stage_info || null);
        setMilestones(data.data.milestones || []);
        setUpdates(data.data.updates || []);
        setScalingPlan(data.data.scaling_plan || null);
      }
    } catch {
      // No journey data yet
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (task?.status === 'completed') {
      fetchData();
      setTaskId(null);
    }
  }, [task, fetchData]);

  async function setStage(stage: StageInfo['current_stage']) {
    try {
      await api.post(`/api/journey/${projectId}/stage`, { current_stage: stage });
      fetchData();
    } catch (err) {
      console.error('Failed to set stage:', err);
    }
  }

  async function generateMilestones() {
    setTaskId(null);
    try {
      const { data } = await api.post<ApiResponse<{ task_id: string }>>(
        `/api/journey/${projectId}/milestones/generate`
      );
      if (data.success) {setTaskId(data.data.task_id);}
    } catch (err) {
      console.error('Failed to generate milestones:', err);
    }
  }

  async function toggleMilestoneStatus(milestone: Milestone) {
    const nextStatus: Record<string, string> = {
      upcoming: 'in_progress',
      in_progress: 'completed',
      completed: 'upcoming',
    };
    const newStatus = nextStatus[milestone.status] || 'upcoming';
    try {
      await api.patch(`/api/journey/${projectId}/milestones/${milestone.milestone_id}`, {
        status: newStatus,
      });
      fetchData();
    } catch (err) {
      console.error('Failed to update milestone:', err);
    }
  }

  async function submitUpdate() {
    try {
      await api.post(`/api/journey/${projectId}/updates`, {
        period: updateForm.period,
        highlights: updateForm.highlights.split('\n').filter(Boolean),
        challenges: updateForm.challenges.split('\n').filter(Boolean),
        asks: updateForm.asks.split('\n').filter(Boolean),
        morale: updateForm.morale,
      });
      setShowUpdateForm(false);
      setUpdateForm({ period: '', highlights: '', challenges: '', asks: '', morale: 7 });
      fetchData();
    } catch (err) {
      console.error('Failed to submit update:', err);
    }
  }

  async function autoGenerateUpdate() {
    setTaskId(null);
    try {
      const { data } = await api.post<ApiResponse<{ task_id: string }>>(
        `/api/journey/${projectId}/updates/generate`
      );
      if (data.success) {setTaskId(data.data.task_id);}
    } catch (err) {
      console.error('Failed to generate update:', err);
    }
  }

  async function generateScalingPlan() {
    setTaskId(null);
    try {
      const { data } = await api.post<ApiResponse<{ task_id: string }>>(
        `/api/journey/${projectId}/scaling-plan/generate`
      );
      if (data.success) {setTaskId(data.data.task_id);}
    } catch (err) {
      console.error('Failed to generate scaling plan:', err);
    }
  }

  const isRunning = task?.status === 'processing' || task?.status === 'pending';

  function milestoneStatusIcon(status: Milestone['status']) {
    switch (status) {
      case 'completed':
        return { icon: '\u2713', cls: 'bg-green-500 text-white' };
      case 'in_progress':
        return { icon: '\u25B6', cls: 'bg-blue-500 text-white' };
      case 'skipped':
        return { icon: '\u2014', cls: 'bg-zinc-600 text-zinc-400' };
      default:
        return { icon: '\u25CB', cls: 'bg-zinc-800 text-zinc-500' };
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
        Loading journey data...
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-white">Startup Journey</h3>
        </div>

        {/* Task Progress */}
        {isRunning && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-zinc-300">{task?.message || 'Processing...'}</span>
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

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b border-zinc-800 pb-px">
          {([
            { key: 'timeline', label: 'Timeline' },
            { key: 'updates', label: 'Updates' },
            { key: 'scaling', label: 'Scaling Plan' },
          ] as { key: Tab; label: string }[]).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                activeTab === tab.key
                  ? 'text-blue-400 bg-blue-500/10 border-b-2 border-blue-500'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Timeline Tab */}
        {activeTab === 'timeline' && (
          <div>
            {/* Stage Selector */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 mb-6">
              <h4 className="text-xs text-zinc-400 mb-3 uppercase tracking-wider">Current Stage</h4>
              <div className="flex items-center gap-2">
                {STAGES.map((stage, i) => {
                  const isCurrent = stageInfo?.current_stage === stage;
                  const stageIndex = stageInfo ? STAGES.indexOf(stageInfo.current_stage) : -1;
                  const isPast = i < stageIndex;

                  return (
                    <div key={stage} className="flex items-center">
                      {i > 0 && (
                        <div
                          className={`w-8 h-px mx-1 ${
                            isPast ? 'bg-blue-500' : 'bg-zinc-700'
                          }`}
                        />
                      )}
                      <button
                        onClick={() => setStage(stage)}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                          isCurrent
                            ? 'bg-blue-500 text-white'
                            : isPast
                              ? 'bg-blue-500/20 text-blue-400'
                              : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300'
                        }`}
                      >
                        {STAGE_LABELS[stage]}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Generate Milestones */}
            <div className="flex justify-end mb-4">
              <button
                onClick={generateMilestones}
                disabled={isRunning}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white rounded-lg text-sm font-medium transition-colors"
              >
                {isRunning ? 'Generating...' : 'Generate Milestones'}
              </button>
            </div>

            {/* Milestones */}
            {milestones.length > 0 ? (
              <div className="space-y-3">
                {milestones.map((milestone) => {
                  const { icon, cls } = milestoneStatusIcon(milestone.status);
                  return (
                    <div
                      key={milestone.milestone_id}
                      className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-start gap-4"
                    >
                      <button
                        onClick={() => toggleMilestoneStatus(milestone)}
                        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium shrink-0 ${cls}`}
                        title="Toggle status"
                      >
                        {icon}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h5 className="text-sm font-medium text-white">{milestone.title}</h5>
                          <span className="text-xs text-zinc-500">Week {milestone.week}</span>
                          {milestone.phase && (
                            <span className="text-xs text-zinc-600">{milestone.phase}</span>
                          )}
                        </div>
                        <p className="text-xs text-zinc-400 mt-1">{milestone.description}</p>
                        {milestone.completed_at && (
                          <span className="text-xs text-green-500 mt-1 inline-block">
                            Completed: {milestone.completed_at}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-12 text-zinc-500 text-sm">
                No milestones yet. Set your stage and generate milestones.
              </div>
            )}
          </div>
        )}

        {/* Updates Tab */}
        {activeTab === 'updates' && (
          <div>
            <div className="flex justify-end gap-2 mb-4">
              <button
                onClick={autoGenerateUpdate}
                disabled={isRunning}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-800 text-zinc-300 rounded-lg text-sm font-medium transition-colors"
              >
                Auto-Generate from Metrics
              </button>
              <button
                onClick={() => setShowUpdateForm(!showUpdateForm)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
              >
                + New Update
              </button>
            </div>

            {/* New Update Form */}
            {showUpdateForm && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-6">
                <h4 className="text-sm font-medium text-white mb-4">New Startup Update</h4>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">Period</label>
                    <input
                      type="text"
                      value={updateForm.period}
                      onChange={(e) => setUpdateForm({ ...updateForm, period: e.target.value })}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                      placeholder="e.g., Week 12, March 2026"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">
                      Highlights (one per line)
                    </label>
                    <textarea
                      value={updateForm.highlights}
                      onChange={(e) => setUpdateForm({ ...updateForm, highlights: e.target.value })}
                      rows={3}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 resize-none"
                      placeholder="What went well this period?"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">
                      Challenges (one per line)
                    </label>
                    <textarea
                      value={updateForm.challenges}
                      onChange={(e) => setUpdateForm({ ...updateForm, challenges: e.target.value })}
                      rows={3}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 resize-none"
                      placeholder="What challenges did you face?"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">Asks (one per line)</label>
                    <textarea
                      value={updateForm.asks}
                      onChange={(e) => setUpdateForm({ ...updateForm, asks: e.target.value })}
                      rows={2}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 resize-none"
                      placeholder="What help do you need?"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-400 mb-2">
                      Team Morale: {updateForm.morale}/10
                    </label>
                    <input
                      type="range"
                      min={1}
                      max={10}
                      value={updateForm.morale}
                      onChange={(e) => setUpdateForm({ ...updateForm, morale: Number(e.target.value) })}
                      className="w-full accent-blue-500"
                    />
                    <div className="flex justify-between text-xs text-zinc-600 mt-1">
                      <span>1</span>
                      <span>5</span>
                      <span>10</span>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setShowUpdateForm(false)}
                      className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={submitUpdate}
                      disabled={!updateForm.period}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                      Submit Update
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Updates List */}
            {updates.length > 0 ? (
              <div className="space-y-4">
                {[...updates].toReversed().map((update) => (
                  <div
                    key={update.update_id}
                    className="bg-zinc-900 border border-zinc-800 rounded-xl p-4"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <h4 className="text-white font-medium">{update.period}</h4>
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-zinc-400">Morale:</span>
                          <span
                            className={`text-xs font-medium ${
                              update.morale >= 7
                                ? 'text-green-400'
                                : update.morale >= 4
                                  ? 'text-yellow-400'
                                  : 'text-red-400'
                            }`}
                          >
                            {update.morale}/10
                          </span>
                        </div>
                      </div>
                      <span className="text-xs text-zinc-500">{update.date}</span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                      {update.highlights && update.highlights.length > 0 && (
                        <div>
                          <h5 className="text-xs font-medium text-green-400 mb-1">Highlights</h5>
                          <ul className="space-y-0.5">
                            {update.highlights.map((h, i) => (
                              <li key={i} className="text-xs text-zinc-300">
                                - {h}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {update.challenges && update.challenges.length > 0 && (
                        <div>
                          <h5 className="text-xs font-medium text-yellow-400 mb-1">Challenges</h5>
                          <ul className="space-y-0.5">
                            {update.challenges.map((c, i) => (
                              <li key={i} className="text-xs text-zinc-300">
                                - {c}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {update.asks && update.asks.length > 0 && (
                        <div>
                          <h5 className="text-xs font-medium text-blue-400 mb-1">Asks</h5>
                          <ul className="space-y-0.5">
                            {update.asks.map((a, i) => (
                              <li key={i} className="text-xs text-zinc-300">
                                - {a}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>

                    {update.generated_summary && (
                      <div className="mt-3 bg-zinc-800/50 rounded-lg p-3">
                        <h5 className="text-xs font-medium text-zinc-400 mb-1">AI Summary</h5>
                        <p className="text-xs text-zinc-300">{update.generated_summary}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-zinc-500 text-sm">
                No updates yet. Create your first startup update to start tracking progress.
              </div>
            )}
          </div>
        )}

        {/* Scaling Plan Tab */}
        {activeTab === 'scaling' && (
          <div>
            <div className="flex justify-end mb-4">
              <button
                onClick={generateScalingPlan}
                disabled={isRunning}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white rounded-lg text-sm font-medium transition-colors"
              >
                {isRunning ? 'Generating...' : 'Generate Scaling Plan'}
              </button>
            </div>

            {scalingPlan && scalingPlan.months && scalingPlan.months.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {scalingPlan.months.map((month) => (
                  <div
                    key={month.month}
                    className="bg-zinc-900 border border-zinc-800 rounded-xl p-4"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-white font-medium">Month {month.month}</h4>
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          month.status === 'completed'
                            ? 'text-green-400 bg-green-500/10'
                            : month.status === 'in_progress'
                              ? 'text-blue-400 bg-blue-500/10'
                              : 'text-zinc-400 bg-zinc-800'
                        }`}
                      >
                        {month.status || 'planned'}
                      </span>
                    </div>
                    <div className="bg-zinc-800/50 rounded-lg px-3 py-2 mb-3">
                      <div className="text-xs text-zinc-400">Focus</div>
                      <div className="text-sm text-white">{month.focus}</div>
                    </div>
                    {month.goals && month.goals.length > 0 && (
                      <div className="mb-3">
                        <h5 className="text-xs font-medium text-green-400 mb-1">Goals</h5>
                        <ul className="space-y-0.5">
                          {month.goals.map((g, i) => (
                            <li key={i} className="text-xs text-zinc-300">
                              - {g}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {month.risks && month.risks.length > 0 && (
                      <div>
                        <h5 className="text-xs font-medium text-red-400 mb-1">Risks</h5>
                        <ul className="space-y-0.5">
                          {month.risks.map((r, i) => (
                            <li key={i} className="text-xs text-zinc-300">
                              - {r}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-zinc-500 text-sm">
                No scaling plan yet. Generate one based on your current stage and metrics.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
