'use client';

import { use, useEffect, useState } from 'react';
import api from '@/api';
import { getStepData } from '@/api/projects';
import { useTaskPolling } from '@/hooks/useTaskPolling';
import type { SimulationResult, SimulatedPersona } from '@/types';

function PersonaCard({ persona }: { persona: SimulatedPersona }) {
  const [expanded, setExpanded] = useState(false);
  const sentimentColor = {
    positive: 'bg-green-500/20 text-green-400',
    neutral: 'bg-yellow-500/20 text-yellow-400',
    negative: 'bg-red-500/20 text-red-400',
  }[persona.sentiment];

  const roleColor = {
    customer: 'text-blue-400',
    investor: 'text-purple-400',
    expert: 'text-cyan-400',
    competitor: 'text-orange-400',
  }[persona.role] || 'text-zinc-400';

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
      <div className="flex items-start justify-between mb-2">
        <div>
          <h5 className="text-white font-medium">{persona.name}</h5>
          <span className={`text-xs ${roleColor}`}>{persona.role} - {persona.profession}</span>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full ${sentimentColor}`}>{persona.sentiment}</span>
      </div>
      <p className="text-xs text-zinc-500 mb-2">{persona.demographics}</p>
      <p className={`text-sm text-zinc-300 ${!expanded ? 'line-clamp-3' : ''}`}>{persona.feedback}</p>
      {persona.feedback.length > 200 && (
        <button onClick={() => setExpanded(!expanded)} className="text-xs text-blue-400 mt-1">
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
      {persona.willingness_to_pay && (
        <div className="text-xs text-green-400 mt-2">Willingness to pay: {persona.willingness_to_pay}</div>
      )}
      {persona.concerns.length > 0 && (
        <div className="mt-2">
          <span className="text-xs text-red-400">Concerns: </span>
          <span className="text-xs text-zinc-400">{persona.concerns.join(', ')}</span>
        </div>
      )}
    </div>
  );
}

export default function SimulationPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { task } = useTaskPolling(taskId);

  useEffect(() => {
    getStepData<SimulationResult>(projectId, 'simulation').then((data) => {
      if (data) {setSimulation(data);}
      setLoading(false);
    });
  }, [projectId]);

  useEffect(() => {
    if (task?.status === 'completed' && task.result) {
      setSimulation(task.result as unknown as SimulationResult);
      setTaskId(null);
    }
  }, [task]);

  async function runSimulation() {
    setTaskId(null);
    const { data } = await api.post('/api/simulation/run', { project_id: projectId });
    if (data.success) {setTaskId(data.data.task_id);}
  }

  const isRunning = task?.status === 'processing' || task?.status === 'pending';

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-white">Market Simulation</h3>
          <button
            onClick={runSimulation}
            disabled={isRunning}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {isRunning ? `Simulating... ${task?.progress || 0}%` : simulation ? 'Re-simulate' : 'Run Simulation'}
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

        {simulation && (
          <>
            {/* Summary */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                <h4 className="text-sm font-medium text-zinc-400 mb-2">Market Reception</h4>
                <p className="text-sm text-zinc-200">{simulation.market_reception_summary}</p>
              </div>
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                <h4 className="text-sm font-medium text-zinc-400 mb-2">Investor Sentiment</h4>
                <p className="text-sm text-zinc-200">{simulation.investor_sentiment}</p>
              </div>
            </div>

            {/* Personas */}
            <h4 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Simulated Personas</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              {simulation.personas.map((persona) => (
                <PersonaCard key={persona.id} persona={persona} />
              ))}
            </div>

            {/* Risk Scenarios */}
            <h4 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Risk Scenarios</h4>
            <div className="space-y-3">
              {simulation.risk_scenarios.map((risk) => (
                <div key={risk.title} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <h5 className="text-white font-medium text-sm">{risk.title}</h5>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      risk.probability === 'high' ? 'bg-red-500/20 text-red-400' :
                      risk.probability === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                      'bg-green-500/20 text-green-400'
                    }`}>P: {risk.probability}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      risk.impact === 'high' ? 'bg-red-500/20 text-red-400' :
                      risk.impact === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                      'bg-green-500/20 text-green-400'
                    }`}>I: {risk.impact}</span>
                  </div>
                  <p className="text-xs text-zinc-400 mb-2">{risk.description}</p>
                  <p className="text-xs text-blue-400">Mitigation: {risk.mitigation}</p>
                </div>
              ))}
            </div>
          </>
        )}

        {!simulation && !isRunning && !loading && (
          <div className="text-center py-20 text-zinc-500">
            <p>Run a simulation to see how the market would react to your idea.</p>
          </div>
        )}
      </div>
    </div>
  );
}
