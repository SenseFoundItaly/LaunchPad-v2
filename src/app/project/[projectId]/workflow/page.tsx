'use client';

import { use, useEffect, useState } from 'react';
import api from '@/api';
import { getStepData } from '@/api/projects';
import { useTaskPolling } from '@/hooks/useTaskPolling';
import type { WorkflowResult } from '@/types';

type Tab = 'gtm' | 'pitch' | 'financial' | 'roadmap' | 'actions';

export default function WorkflowPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const [workflow, setWorkflow] = useState<WorkflowResult | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('gtm');
  const [loading, setLoading] = useState(true);
  const { task } = useTaskPolling(taskId);

  useEffect(() => {
    getStepData<WorkflowResult>(projectId, 'workflow').then((data) => {
      if (data) {setWorkflow(data);}
      setLoading(false);
    });
  }, [projectId]);

  useEffect(() => {
    if (task?.status === 'completed' && task.result) {
      setWorkflow(task.result as unknown as WorkflowResult);
      setTaskId(null);
    }
  }, [task]);

  async function generateWorkflow() {
    setTaskId(null);
    const { data } = await api.post('/api/workflow/generate', { project_id: projectId });
    if (data.success) {setTaskId(data.data.task_id);}
  }

  const isRunning = task?.status === 'processing' || task?.status === 'pending';

  const tabs: { key: Tab; label: string }[] = [
    { key: 'gtm', label: 'GTM Strategy' },
    { key: 'pitch', label: 'Pitch Deck' },
    { key: 'financial', label: 'Financials' },
    { key: 'roadmap', label: 'Roadmap' },
    { key: 'actions', label: 'Action Items' },
  ];

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-white">Launch Workflow</h3>
          <button
            onClick={generateWorkflow}
            disabled={isRunning}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {isRunning ? `Generating... ${task?.progress || 0}%` : workflow ? 'Regenerate' : 'Generate Plan'}
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

        {workflow && (
          <>
            {/* Tab bar */}
            <div className="flex gap-1 mb-6 bg-zinc-900 rounded-lg p-1">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    activeTab === tab.key ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* GTM Strategy */}
            {activeTab === 'gtm' && workflow.gtm_strategy && (
              <div className="space-y-4">
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                  <h4 className="text-sm font-medium text-zinc-400 mb-2">Target Segments</h4>
                  <ul className="space-y-1">
                    {workflow.gtm_strategy.target_segments.map((seg, i) => (
                      <li key={i} className="text-sm text-zinc-200">{seg}</li>
                    ))}
                  </ul>
                </div>
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                  <h4 className="text-sm font-medium text-zinc-400 mb-2">Channels</h4>
                  {workflow.gtm_strategy.channels.map((ch) => (
                    <div key={ch.name} className="flex items-start gap-3 py-2 border-b border-zinc-800 last:border-0">
                      <div className="flex-1">
                        <div className="text-sm text-white font-medium">{ch.name}</div>
                        <div className="text-xs text-zinc-400">{ch.strategy}</div>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        ch.priority === 'high' ? 'bg-red-500/20 text-red-400' :
                        ch.priority === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                        'bg-green-500/20 text-green-400'
                      }`}>{ch.priority}</span>
                    </div>
                  ))}
                </div>
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                  <h4 className="text-sm font-medium text-zinc-400 mb-2">Pricing</h4>
                  <p className="text-sm text-zinc-200">{workflow.gtm_strategy.pricing}</p>
                </div>
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                  <h4 className="text-sm font-medium text-zinc-400 mb-2">Launch Plan</h4>
                  <p className="text-sm text-zinc-200 whitespace-pre-wrap">{workflow.gtm_strategy.launch_plan}</p>
                </div>
              </div>
            )}

            {/* Pitch Deck */}
            {activeTab === 'pitch' && workflow.pitch_deck && (
              <div className="space-y-4">
                {workflow.pitch_deck.map((slide, i) => (
                  <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                    <div className="text-xs text-blue-400 mb-1">Slide {i + 1}</div>
                    <h4 className="text-white font-medium mb-2">{slide.slide}</h4>
                    <p className="text-sm text-zinc-300 whitespace-pre-wrap">{slide.content}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Financial Model */}
            {activeTab === 'financial' && workflow.financial_model && (
              <div className="space-y-4">
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                  <h4 className="text-sm font-medium text-zinc-400 mb-2">Assumptions</h4>
                  <ul className="space-y-1">
                    {workflow.financial_model.assumptions.map((a, i) => (
                      <li key={i} className="text-sm text-zinc-200">{a}</li>
                    ))}
                  </ul>
                </div>
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-zinc-800">
                        <th className="text-left px-4 py-2 text-zinc-400 font-medium">Period</th>
                        <th className="text-right px-4 py-2 text-zinc-400 font-medium">Revenue</th>
                        <th className="text-right px-4 py-2 text-zinc-400 font-medium">Costs</th>
                        <th className="text-right px-4 py-2 text-zinc-400 font-medium">Profit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {workflow.financial_model.projections.map((row) => (
                        <tr key={row.period} className="border-t border-zinc-800">
                          <td className="px-4 py-2 text-zinc-200">{row.period}</td>
                          <td className="px-4 py-2 text-right text-green-400">{row.revenue}</td>
                          <td className="px-4 py-2 text-right text-red-400">{row.costs}</td>
                          <td className="px-4 py-2 text-right text-zinc-200">{row.profit}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4">
                  <h4 className="text-sm font-medium text-blue-400 mb-1">Funding Needed</h4>
                  <p className="text-sm text-zinc-200">{workflow.financial_model.funding_needed}</p>
                </div>
              </div>
            )}

            {/* Roadmap */}
            {activeTab === 'roadmap' && workflow.roadmap && (
              <div className="space-y-3">
                {workflow.roadmap.map((milestone, i) => (
                  <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex gap-4">
                    <div className="flex flex-col items-center">
                      <div className="w-3 h-3 rounded-full bg-blue-500" />
                      {i < workflow.roadmap.length - 1 && <div className="w-px flex-1 bg-zinc-700 mt-1" />}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <h5 className="text-white font-medium text-sm">{milestone.milestone}</h5>
                        <span className="text-xs text-zinc-500">{milestone.timeline}</span>
                      </div>
                      <ul className="space-y-1">
                        {milestone.deliverables.map((d, j) => (
                          <li key={j} className="text-xs text-zinc-400">- {d}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Action Items */}
            {activeTab === 'actions' && workflow.action_items && (
              <div className="space-y-2">
                {workflow.action_items.map((item, i) => (
                  <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-start justify-between">
                    <div>
                      <p className="text-sm text-zinc-200">{item.task}</p>
                      <div className="flex gap-2 mt-1">
                        <span className="text-xs text-zinc-500">{item.timeline}</span>
                        <span className="text-xs text-zinc-500">{item.owner}</span>
                      </div>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${
                      item.priority === 'high' ? 'bg-red-500/20 text-red-400' :
                      item.priority === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                      'bg-green-500/20 text-green-400'
                    }`}>{item.priority}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {!workflow && !isRunning && !loading && (
          <div className="text-center py-20 text-zinc-500">
            <p>Generate a launch plan including GTM strategy, pitch deck, financials, and roadmap.</p>
          </div>
        )}
      </div>
    </div>
  );
}
