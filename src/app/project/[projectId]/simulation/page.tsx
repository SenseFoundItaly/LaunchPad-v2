'use client';

import { use, useEffect, useState } from 'react';
import api from '@/api';
import { getStepData } from '@/api/projects';
import { useTaskPolling } from '@/hooks/useTaskPolling';
import type { SimulationResult, SimulatedPersona } from '@/types';

function PersonaCard({ persona }: { persona: SimulatedPersona }) {
  const [expanded, setExpanded] = useState(false);
  const sentimentColor = {
    positive: 'bg-moss/20 text-moss',
    neutral: 'bg-accent/20 text-accent',
    negative: 'bg-clay/20 text-clay',
  }[persona.sentiment];

  const roleColor = {
    customer: 'text-moss',
    investor: 'text-plum',
    expert: 'text-cyan-400',
    competitor: 'text-orange-400',
  }[persona.role] || 'text-ink-4';

  return (
    <div className="bg-paper border border-line rounded-xl p-4">
      <div className="flex items-start justify-between mb-2">
        <div>
          <h5 className="text-white font-medium">{persona.name}</h5>
          <span className={`text-xs ${roleColor}`}>{persona.role} - {persona.profession}</span>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full ${sentimentColor}`}>{persona.sentiment}</span>
      </div>
      <p className="text-xs text-ink-5 mb-2">{persona.demographics}</p>
      <p className={`text-sm text-ink-3 ${!expanded ? 'line-clamp-3' : ''}`}>{persona.feedback}</p>
      {persona.feedback.length > 200 && (
        <button onClick={() => setExpanded(!expanded)} className="text-xs text-moss mt-1">
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
      {persona.willingness_to_pay && (
        <div className="text-xs text-moss mt-2">Willingness to pay: {persona.willingness_to_pay}</div>
      )}
      {persona.concerns.length > 0 && (
        <div className="mt-2">
          <span className="text-xs text-clay">Concerns: </span>
          <span className="text-xs text-ink-4">{persona.concerns.join(', ')}</span>
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
            className="px-4 py-2 bg-moss hover:bg-moss disabled:bg-paper-3 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {isRunning ? `Simulating... ${task?.progress || 0}%` : simulation ? 'Re-simulate' : 'Run Simulation'}
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

        {simulation && (
          <>
            {/* Summary */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <div className="bg-paper border border-line rounded-xl p-4">
                <h4 className="text-sm font-medium text-ink-4 mb-2">Market Reception</h4>
                <p className="text-sm text-ink-2">{simulation.market_reception_summary}</p>
              </div>
              <div className="bg-paper border border-line rounded-xl p-4">
                <h4 className="text-sm font-medium text-ink-4 mb-2">Investor Sentiment</h4>
                <p className="text-sm text-ink-2">{simulation.investor_sentiment}</p>
              </div>
            </div>

            {/* Personas */}
            <h4 className="text-sm font-medium text-ink-4 uppercase tracking-wider mb-3">Simulated Personas</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              {simulation.personas.map((persona) => (
                <PersonaCard key={persona.id} persona={persona} />
              ))}
            </div>

            {/* Risk Scenarios */}
            <h4 className="text-sm font-medium text-ink-4 uppercase tracking-wider mb-3">Risk Scenarios</h4>
            <div className="space-y-3">
              {simulation.risk_scenarios.map((risk) => (
                <div key={risk.title} className="bg-paper border border-line rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <h5 className="text-white font-medium text-sm">{risk.title}</h5>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      risk.probability === 'high' ? 'bg-clay/20 text-clay' :
                      risk.probability === 'medium' ? 'bg-accent/20 text-accent' :
                      'bg-moss/20 text-moss'
                    }`}>P: {risk.probability}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      risk.impact === 'high' ? 'bg-clay/20 text-clay' :
                      risk.impact === 'medium' ? 'bg-accent/20 text-accent' :
                      'bg-moss/20 text-moss'
                    }`}>I: {risk.impact}</span>
                  </div>
                  <p className="text-xs text-ink-4 mb-2">{risk.description}</p>
                  <p className="text-xs text-moss">Mitigation: {risk.mitigation}</p>
                </div>
              ))}
            </div>
          </>
        )}

        {!simulation && !isRunning && !loading && (
          <div className="text-center py-20 text-ink-5">
            <p>Run a simulation to see how the market would react to your idea.</p>
          </div>
        )}
      </div>
    </div>
  );
}
