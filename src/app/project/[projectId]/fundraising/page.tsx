'use client';

import { use, useEffect, useState, useCallback } from 'react';
import api from '@/api';
import { useTaskPolling } from '@/hooks/useTaskPolling';
import type {
  Investor,
  InvestorInteraction,
  PitchVersion,
  TermSheet,
  FundraisingData,
  ApiResponse,
} from '@/types';

const PIPELINE_STAGES = [
  'Target',
  'Intro',
  'Meeting',
  'Pitch',
  'Due Diligence',
  'Term Sheet',
  'Committed',
  'Passed',
];

type Tab = 'pipeline' | 'pitch' | 'termsheets';

export default function FundraisingPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);

  const [activeTab, setActiveTab] = useState<Tab>('pipeline');
  const [investors, setInvestors] = useState<Investor[]>([]);
  const [pitchVersions, setPitchVersions] = useState<PitchVersion[]>([]);
  const [termSheets, setTermSheets] = useState<TermSheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [taskId, setTaskId] = useState<string | null>(null);
  const { task } = useTaskPolling(taskId);

  // Forms
  const [showAddInvestor, setShowAddInvestor] = useState(false);
  const [investorForm, setInvestorForm] = useState({
    name: '',
    type: 'VC',
    contact_name: '',
    contact_email: '',
    check_size: 0,
    notes: '',
  });
  const [expandedInvestor, setExpandedInvestor] = useState<string | null>(null);
  const [interactionForm, setInteractionForm] = useState({
    investorId: '',
    type: 'email',
    summary: '',
    next_step: '',
    next_step_date: '',
  });
  const [showAddTermSheet, setShowAddTermSheet] = useState(false);
  const [termSheetForm, setTermSheetForm] = useState({
    investor_id: '',
    valuation: 0,
    amount: 0,
    instrument: 'SAFE',
    key_terms: '',
    notes: '',
  });
  const [expandedPitch, setExpandedPitch] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const { data } = await api.get<ApiResponse<FundraisingData>>(
        `/api/fundraising/${projectId}`
      );
      if (data.data) {
        setInvestors(data.data.investors || []);
        setPitchVersions(data.data.pitch_versions || []);
        setTermSheets(data.data.term_sheets || []);
      }
    } catch {
      // No fundraising data yet
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

  // Refresh on cross-page events. Chat investor tools (add_investor /
  // move_investor_stage / log_investor_interaction) write directly to the
  // DB; the org/intelligence pages already listen for these events and
  // refetch. Mirror that here so the Raise pipeline stays in sync without
  // a hard reload when the founder mutates investors via chat.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => { fetchData(); };
    window.addEventListener('lp-tasks-changed', handler);
    window.addEventListener('lp-data-changed', handler);
    return () => {
      window.removeEventListener('lp-tasks-changed', handler);
      window.removeEventListener('lp-data-changed', handler);
    };
  }, [fetchData]);

  async function addInvestor() {
    try {
      await api.post(`/api/fundraising/${projectId}/investors`, investorForm);
      setShowAddInvestor(false);
      setInvestorForm({ name: '', type: 'VC', contact_name: '', contact_email: '', check_size: 0, notes: '' });
      fetchData();
    } catch (err) {
      console.error('Failed to add investor:', err);
    }
  }

  async function moveInvestorStage(investorId: string, newStage: string) {
    try {
      await api.patch(`/api/fundraising/${projectId}/investors/${investorId}`, { stage: newStage });
      fetchData();
    } catch (err) {
      console.error('Failed to move investor:', err);
    }
  }

  async function addInteraction() {
    try {
      const { investorId, ...payload } = interactionForm;
      await api.post(
        `/api/fundraising/${projectId}/investors/${investorId}/interactions`,
        { ...payload, date: new Date().toISOString().split('T')[0] }
      );
      setInteractionForm({ investorId: '', type: 'email', summary: '', next_step: '', next_step_date: '' });
      fetchData();
    } catch (err) {
      console.error('Failed to add interaction:', err);
    }
  }

  async function iteratePitch() {
    setTaskId(null);
    try {
      const { data } = await api.post<ApiResponse<{ task_id: string }>>(
        `/api/fundraising/${projectId}/pitch/iterate`
      );
      if (data.success) {setTaskId(data.data.task_id);}
    } catch (err) {
      console.error('Failed to iterate pitch:', err);
    }
  }

  async function addTermSheet() {
    try {
      await api.post(`/api/fundraising/${projectId}/term-sheets`, termSheetForm);
      setShowAddTermSheet(false);
      setTermSheetForm({ investor_id: '', valuation: 0, amount: 0, instrument: 'SAFE', key_terms: '', notes: '' });
      fetchData();
    } catch (err) {
      console.error('Failed to add term sheet:', err);
    }
  }

  async function analyzeTermSheet(termSheetId: string) {
    setTaskId(null);
    try {
      const { data } = await api.post<ApiResponse<{ task_id: string }>>(
        `/api/fundraising/${projectId}/term-sheets/${termSheetId}/analyze`
      );
      if (data.success) {setTaskId(data.data.task_id);}
    } catch (err) {
      console.error('Failed to analyze term sheet:', err);
    }
  }

  const isRunning = task?.status === 'processing' || task?.status === 'pending';

  function getLastInteractionDate(investor: Investor): string {
    if (!investor.interactions || investor.interactions.length === 0) {return 'No interactions';}
    return investor.interactions[investor.interactions.length - 1].date;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
        Loading fundraising data...
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-white">Fundraising OS</h3>
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
            { key: 'pipeline', label: 'Pipeline' },
            { key: 'pitch', label: 'Pitch' },
            { key: 'termsheets', label: 'Term Sheets' },
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

        {/* Pipeline Tab */}
        {activeTab === 'pipeline' && (
          <div>
            <div className="flex justify-end mb-4">
              <button
                onClick={() => setShowAddInvestor(!showAddInvestor)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
              >
                + Add Investor
              </button>
            </div>

            {/* Add Investor Form */}
            {showAddInvestor && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-6">
                <h4 className="text-sm font-medium text-white mb-4">Add Investor</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">Name</label>
                    <input
                      type="text"
                      value={investorForm.name}
                      onChange={(e) => setInvestorForm({ ...investorForm, name: e.target.value })}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                      placeholder="Fund or Angel name"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">Type</label>
                    <select
                      value={investorForm.type}
                      onChange={(e) => setInvestorForm({ ...investorForm, type: e.target.value })}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                    >
                      <option value="VC">VC</option>
                      <option value="Angel">Angel</option>
                      <option value="Syndicate">Syndicate</option>
                      <option value="Corporate">Corporate</option>
                      <option value="Accelerator">Accelerator</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">Check Size ($)</label>
                    <input
                      type="number"
                      value={investorForm.check_size}
                      onChange={(e) => setInvestorForm({ ...investorForm, check_size: Number(e.target.value) })}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">Contact Name</label>
                    <input
                      type="text"
                      value={investorForm.contact_name}
                      onChange={(e) => setInvestorForm({ ...investorForm, contact_name: e.target.value })}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">Contact Email</label>
                    <input
                      type="email"
                      value={investorForm.contact_email}
                      onChange={(e) => setInvestorForm({ ...investorForm, contact_email: e.target.value })}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">Notes</label>
                    <input
                      type="text"
                      value={investorForm.notes}
                      onChange={(e) => setInvestorForm({ ...investorForm, notes: e.target.value })}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-4">
                  <button
                    onClick={() => setShowAddInvestor(false)}
                    className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={addInvestor}
                    disabled={!investorForm.name}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    Add
                  </button>
                </div>
              </div>
            )}

            {/* Kanban Columns */}
            <div className="flex gap-3 overflow-x-auto pb-4">
              {PIPELINE_STAGES.map((stage) => {
                const stageInvestors = investors.filter((inv) => inv.stage === stage);
                return (
                  <div
                    key={stage}
                    className="flex-shrink-0 w-56 bg-zinc-900/50 border border-zinc-800 rounded-xl"
                  >
                    <div className="px-3 py-2 border-b border-zinc-800">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-zinc-300">{stage}</span>
                        <span className="text-xs text-zinc-500">{stageInvestors.length}</span>
                      </div>
                    </div>
                    <div className="p-2 space-y-2 min-h-[100px]">
                      {stageInvestors.map((investor) => (
                        <div key={investor.investor_id}>
                          <button
                            onClick={() =>
                              setExpandedInvestor(
                                expandedInvestor === investor.investor_id ? null : investor.investor_id
                              )
                            }
                            className="w-full text-left bg-zinc-800 hover:bg-zinc-750 rounded-lg p-3 transition-colors"
                          >
                            <div className="text-sm text-white font-medium truncate">
                              {investor.name}
                            </div>
                            <div className="text-xs text-zinc-400 mt-1">{investor.type}</div>
                            {investor.check_size > 0 && (
                              <div className="text-xs text-zinc-500 mt-0.5">
                                ${investor.check_size.toLocaleString()}
                              </div>
                            )}
                            <div className="text-xs text-zinc-600 mt-1">
                              {getLastInteractionDate(investor)}
                            </div>
                          </button>

                          {/* Expanded Investor Detail */}
                          {expandedInvestor === investor.investor_id && (
                            <div className="mt-2 bg-zinc-800/50 rounded-lg p-3 space-y-3">
                              {/* Move stage buttons */}
                              <div>
                                <label className="block text-xs text-zinc-400 mb-1">Move to:</label>
                                <div className="flex flex-wrap gap-1">
                                  {PIPELINE_STAGES.filter((s) => s !== stage).map((s) => (
                                    <button
                                      key={s}
                                      onClick={() => moveInvestorStage(investor.investor_id, s)}
                                      className="px-2 py-0.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded text-xs transition-colors"
                                    >
                                      {s}
                                    </button>
                                  ))}
                                </div>
                              </div>

                              {investor.notes && (
                                <p className="text-xs text-zinc-400">{investor.notes}</p>
                              )}

                              {/* Interaction History */}
                              {investor.interactions && investor.interactions.length > 0 && (
                                <div>
                                  <div className="text-xs text-zinc-400 mb-1">Interactions:</div>
                                  <div className="space-y-1">
                                    {investor.interactions.slice(-3).map((inter: InvestorInteraction, i: number) => (
                                      <div key={i} className="text-xs text-zinc-500">
                                        <span className="text-zinc-400">{inter.date}</span> -{' '}
                                        {inter.type}: {inter.summary}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Add Interaction */}
                              {interactionForm.investorId === investor.investor_id ? (
                                <div className="space-y-2">
                                  <select
                                    value={interactionForm.type}
                                    onChange={(e) =>
                                      setInteractionForm({ ...interactionForm, type: e.target.value })
                                    }
                                    className="w-full bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-xs text-white"
                                  >
                                    <option value="email">Email</option>
                                    <option value="call">Call</option>
                                    <option value="meeting">Meeting</option>
                                    <option value="pitch">Pitch</option>
                                    <option value="other">Other</option>
                                  </select>
                                  <input
                                    type="text"
                                    value={interactionForm.summary}
                                    onChange={(e) =>
                                      setInteractionForm({ ...interactionForm, summary: e.target.value })
                                    }
                                    placeholder="Summary"
                                    className="w-full bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-xs text-white"
                                  />
                                  <input
                                    type="text"
                                    value={interactionForm.next_step}
                                    onChange={(e) =>
                                      setInteractionForm({ ...interactionForm, next_step: e.target.value })
                                    }
                                    placeholder="Next step"
                                    className="w-full bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-xs text-white"
                                  />
                                  <div className="flex gap-1">
                                    <button
                                      onClick={() =>
                                        setInteractionForm({
                                          investorId: '',
                                          type: 'email',
                                          summary: '',
                                          next_step: '',
                                          next_step_date: '',
                                        })
                                      }
                                      className="px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200"
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      onClick={addInteraction}
                                      className="px-2 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs"
                                    >
                                      Save
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <button
                                  onClick={() =>
                                    setInteractionForm({
                                      ...interactionForm,
                                      investorId: investor.investor_id,
                                    })
                                  }
                                  className="text-xs text-blue-400 hover:text-blue-300"
                                >
                                  + Add Interaction
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {investors.length === 0 && (
              <div className="text-center py-12 text-zinc-500 text-sm">
                No investors in your pipeline yet. Add investors to start tracking.
              </div>
            )}
          </div>
        )}

        {/* Pitch Tab */}
        {activeTab === 'pitch' && (
          <div>
            <div className="flex justify-end mb-4">
              <button
                onClick={iteratePitch}
                disabled={isRunning}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white rounded-lg text-sm font-medium transition-colors"
              >
                {isRunning ? 'Iterating...' : 'Iterate Pitch'}
              </button>
            </div>

            {pitchVersions.length > 0 ? (
              <div className="space-y-4">
                {[...pitchVersions]
                  .toSorted((a, b) => b.version_number - a.version_number)
                  .map((version, i) => (
                    <div
                      key={version.version_id}
                      className={`bg-zinc-900 border rounded-xl p-4 ${
                        i === 0 ? 'border-blue-500/30' : 'border-zinc-800'
                      }`}
                    >
                      <button
                        onClick={() =>
                          setExpandedPitch(expandedPitch === version.version_id ? null : version.version_id)
                        }
                        className="w-full text-left"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span className="text-white font-medium">
                              Version {version.version_number}
                            </span>
                            {i === 0 && (
                              <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded-full text-xs">
                                Latest
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-zinc-500">{version.created_at}</span>
                        </div>
                        {version.feedback_summary && (
                          <p className="text-sm text-zinc-400 mt-2">{version.feedback_summary}</p>
                        )}
                      </button>

                      {expandedPitch === version.version_id && (
                        <div className="mt-4 space-y-3">
                          {version.changelog && version.changelog.length > 0 && (
                            <div className="bg-zinc-800/50 rounded-lg p-3">
                              <h5 className="text-xs font-medium text-zinc-400 mb-2">Changes</h5>
                              <ul className="space-y-1">
                                {version.changelog.map((change, ci) => (
                                  <li key={ci} className="text-xs text-zinc-300">
                                    - {change}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {version.slides &&
                            version.slides.map((slide, si) => (
                              <div key={si} className="bg-zinc-800/50 rounded-lg p-3">
                                <h5 className="text-xs font-medium text-blue-400 mb-1">
                                  {slide.slide}
                                </h5>
                                <p className="text-sm text-zinc-300">{slide.content}</p>
                                {slide.speaker_notes && (
                                  <p className="text-xs text-zinc-500 mt-2 italic">
                                    Notes: {slide.speaker_notes}
                                  </p>
                                )}
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            ) : (
              <div className="text-center py-12 text-zinc-500 text-sm">
                No pitch versions yet. Click &quot;Iterate Pitch&quot; to generate your first pitch deck.
              </div>
            )}
          </div>
        )}

        {/* Term Sheets Tab */}
        {activeTab === 'termsheets' && (
          <div>
            <div className="flex justify-end mb-4">
              <button
                onClick={() => setShowAddTermSheet(!showAddTermSheet)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
              >
                + Add Term Sheet
              </button>
            </div>

            {/* Add Term Sheet Form */}
            {showAddTermSheet && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-6">
                <h4 className="text-sm font-medium text-white mb-4">Add Term Sheet</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">Investor</label>
                    <select
                      value={termSheetForm.investor_id}
                      onChange={(e) => setTermSheetForm({ ...termSheetForm, investor_id: e.target.value })}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                    >
                      <option value="">Select investor</option>
                      {investors.map((inv) => (
                        <option key={inv.investor_id} value={inv.investor_id}>
                          {inv.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">Valuation ($)</label>
                    <input
                      type="number"
                      value={termSheetForm.valuation}
                      onChange={(e) => setTermSheetForm({ ...termSheetForm, valuation: Number(e.target.value) })}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">Amount ($)</label>
                    <input
                      type="number"
                      value={termSheetForm.amount}
                      onChange={(e) => setTermSheetForm({ ...termSheetForm, amount: Number(e.target.value) })}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">Instrument</label>
                    <select
                      value={termSheetForm.instrument}
                      onChange={(e) => setTermSheetForm({ ...termSheetForm, instrument: e.target.value })}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                    >
                      <option value="SAFE">SAFE</option>
                      <option value="Convertible Note">Convertible Note</option>
                      <option value="Priced Round">Priced Round</option>
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs text-zinc-400 mb-1">Key Terms</label>
                    <input
                      type="text"
                      value={termSheetForm.key_terms}
                      onChange={(e) => setTermSheetForm({ ...termSheetForm, key_terms: e.target.value })}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                      placeholder="e.g., MFN, pro-rata rights"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-4">
                  <button
                    onClick={() => setShowAddTermSheet(false)}
                    className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={addTermSheet}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    Add
                  </button>
                </div>
              </div>
            )}

            {termSheets.length > 0 ? (
              <div className="space-y-4">
                {termSheets.map((ts) => {
                  const investor = investors.find((inv) => inv.investor_id === ts.investor_id);
                  return (
                    <div
                      key={ts.term_sheet_id}
                      className="bg-zinc-900 border border-zinc-800 rounded-xl p-4"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <h4 className="text-white font-medium">
                            {investor?.name || 'Unknown Investor'}
                          </h4>
                          <span className="text-xs text-zinc-500">{ts.received_at}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                              ts.status === 'accepted'
                                ? 'text-green-400 bg-green-500/10'
                                : ts.status === 'rejected'
                                  ? 'text-red-400 bg-red-500/10'
                                  : 'text-yellow-400 bg-yellow-500/10'
                            }`}
                          >
                            {ts.status || 'pending'}
                          </span>
                          <button
                            onClick={() => analyzeTermSheet(ts.term_sheet_id)}
                            disabled={isRunning}
                            className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-800 text-zinc-300 rounded-lg text-xs transition-colors"
                          >
                            Analyze
                          </button>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-4 text-sm">
                        <div>
                          <div className="text-xs text-zinc-400">Valuation</div>
                          <div className="text-white">${ts.valuation.toLocaleString()}</div>
                        </div>
                        <div>
                          <div className="text-xs text-zinc-400">Amount</div>
                          <div className="text-white">${ts.amount.toLocaleString()}</div>
                        </div>
                        <div>
                          <div className="text-xs text-zinc-400">Instrument</div>
                          <div className="text-white">{ts.instrument}</div>
                        </div>
                      </div>
                      {ts.key_terms && (
                        <p className="text-xs text-zinc-400 mt-2">Terms: {ts.key_terms}</p>
                      )}
                      {ts.notes && (
                        <p className="text-xs text-zinc-500 mt-1">{ts.notes}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-12 text-zinc-500 text-sm">
                No term sheets yet. Add them as you receive offers.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
