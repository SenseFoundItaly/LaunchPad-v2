'use client';

import { use, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import ChatPanel from '@/components/chat/ChatPanel';
import KnowledgeGraph from '@/components/graph/KnowledgeGraph';
import NodeDetailPanel from '@/components/graph/NodeDetailPanel';
import GraphLegend from '@/components/graph/GraphLegend';
import { useChat } from '@/hooks/useChat';
import { useKnowledgeGraph } from '@/hooks/useKnowledgeGraph';
import { useProject } from '@/hooks/useProject';
import api from '@/api';
import type { GraphNode } from '@/types/graph';
import type { EntityCard, WorkflowCard } from '@/types/artifacts';

type SidebarMode = 'graph' | 'metrics' | 'pipeline' | 'workflows';

export default function IdeaPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const { project } = useProject(projectId);
  const { messages, isStreaming, sendMessage, setMessages } = useChat(projectId, 'idea');
  const { graph, addNode, addEdge } = useKnowledgeGraph(projectId);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('graph');
  const [metrics, setMetrics] = useState<{ name: string; value: number; growth: string }[]>([]);
  const [investors, setInvestors] = useState<{ name: string; stage: string; check_size: number }[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowCard[]>([]);
  const [autoStarted, setAutoStarted] = useState(false);

  // Load existing chat history
  useEffect(() => {
    api.get(`/api/chat/history?project_id=${projectId}&step=idea`).then(({ data }) => {
      if (data.success && data.data && data.data.length > 0) {
        setMessages(
          data.data.map((m: { role: string; content: string; timestamp: string }, i: number) => ({
            id: `restored_${i}`,
            role: m.role as 'user' | 'assistant',
            content: m.content,
            timestamp: m.timestamp,
          }))
        );
        setAutoStarted(true); // has history, don't auto-send
      }
    }).catch(() => {});

    // Load metrics for sidebar
    api.get(`/api/dashboard/${projectId}/metrics`).then(({ data }) => {
      if (data.success && data.data?.metrics) {
        setMetrics(data.data.metrics.map((m: { name: string; entries: { value: number }[] }) => ({
          name: m.name,
          value: m.entries?.[m.entries.length - 1]?.value || 0,
          growth: m.entries?.length > 1 ? `${(((m.entries[m.entries.length - 1]?.value || 0) / (m.entries[m.entries.length - 2]?.value || 1) - 1) * 100).toFixed(1)}%` : '-',
        })));
      }
    }).catch(() => {});

    // Load investors for sidebar
    api.get(`/api/fundraising/${projectId}`).then(({ data }) => {
      if (data.success && data.data?.investors) {
        setInvestors(data.data.investors);
      }
    }).catch(() => {});
  }, [projectId, setMessages]);

  // Auto-start: when new project loads with no chat history, immediately analyze the idea
  useEffect(() => {
    if (!autoStarted && !isStreaming && messages.length === 0 && project?.name) {
      setAutoStarted(true);
      const kickoff = project.description
        ? `Analyze this startup idea and map the competitive landscape: "${project.name}" — ${project.description}`
        : `Analyze this startup idea and map the competitive landscape: "${project.name}"`;
      sendMessage(kickoff);
    }
  }, [autoStarted, isStreaming, messages.length, project, sendMessage]);

  // Only switch sidebar when that tab has actual data — don't switch to empty tabs
  useEffect(() => {
    if (graph.nodes.length > 0) {
      setSidebarMode('graph');
    }
  }, [graph.nodes.length]);

  // Save chat history
  useEffect(() => {
    if (!isStreaming && messages.length > 0) {
      api.post('/api/chat/history', {
        project_id: projectId,
        step: 'idea',
        messages: messages.map((m) => ({ role: m.role, content: m.content, timestamp: m.timestamp })),
      }).catch(() => {});
    }
  }, [isStreaming, messages, projectId]);

  // Relation map: how each entity type connects to Your Startup
  const TYPE_RELATIONS: Record<string, string> = {
    competitor: 'competes_with',
    technology: 'relevant_to',
    market_segment: 'targets',
    persona: 'serves',
    risk: 'threatens',
    trend: 'affects',
    company: 'related_to',
    compliance: 'must_comply_with',
    regulation: 'regulated_by',
    partner: 'partners_with',
    funding_source: 'funded_by',
    feature: 'offers',
    metric: 'tracks',
  };

  // Ensure "Your Startup" node exists — created once on mount
  const startupCreatedRef = useRef(false);
  useEffect(() => {
    if (project?.name && !startupCreatedRef.current) {
      startupCreatedRef.current = true;
      // Check if it already exists in loaded graph
      if (!graph.nodes.some(n => n.node_type === 'your_startup')) {
        addNode({
          name: project.name,
          node_type: 'your_startup' as GraphNode['node_type'],
          summary: project.description || 'Your startup',
          attributes: {},
        });
      }
    }
  }, [project, graph.nodes, addNode]);

  // Handle entity discovered — ONLY add nodes (no edges during streaming)
  const handleEntityDiscovered = useCallback(async (entity: EntityCard) => {
    await addNode({
      name: entity.name,
      node_type: entity.entity_type as GraphNode['node_type'],
      summary: entity.summary,
      attributes: entity.attributes,
    });
    setSidebarMode('graph');
  }, [addNode]);

  // After streaming stops → connect all unconnected nodes to startup
  const prevStreamingRef = useRef(false);
  useEffect(() => {
    const wasStreaming = prevStreamingRef.current;
    prevStreamingRef.current = isStreaming;

    // Only run when streaming just stopped (true → false)
    if (wasStreaming && !isStreaming && graph.nodes.length > 1) {
      const startup = graph.nodes.find(n => n.node_type === 'your_startup');
      if (!startup) {return;}

      for (const node of graph.nodes) {
        if (node.id === startup.id) {continue;}
        // Skip if edge already exists (check both directions)
        const hasEdge = graph.edges.some(e => {
          const srcId = typeof e.source === 'string' ? e.source : e.source?.id;
          const tgtId = typeof e.target === 'string' ? e.target : e.target?.id;
          return (srcId === node.id && tgtId === startup.id) ||
                 (srcId === startup.id && tgtId === node.id);
        });
        if (!hasEdge) {
          const relation = TYPE_RELATIONS[node.node_type] || 'related_to';
          addEdge({ source: node.id, target: startup.id, relation, weight: 1.0 });
        }
      }
    }
  }, [isStreaming, graph.nodes, graph.edges, addEdge]);

  // Handle workflow discovered → add to workflows list
  const handleWorkflowDiscovered = useCallback((workflow: WorkflowCard) => {
    setWorkflows(prev => {
      if (prev.some(w => w.title === workflow.title)) {return prev;}
      return [...prev, workflow];
    });
  }, []);

  // Handle artifact actions
  const handleArtifactAction = useCallback((action: string, payload: Record<string, unknown>) => {
    if (action === 'select-option') {
      sendMessage(`I choose: ${payload.label}`);
    } else if (action === 'trigger-action') {
      const title = (payload.title || payload.action_label || '') as string;
      const desc = (payload.description || '') as string;
      // Send specific action request to AI
      sendMessage(`${title}${desc ? ': ' + desc : ''}. Give me a detailed step-by-step plan.`);
      // Also add to workflows sidebar
      setWorkflows(prev => {
        if (prev.some(w => w.title === title)) {return prev;}
        return [...prev, {
          type: 'workflow-card' as const,
          id: `wf_auto_${Date.now()}`,
          title,
          category: 'operations' as const,
          description: desc,
          priority: 'medium' as const,
          steps: [],
          // Source enforcement (Phase A): this is a UI-initiated workflow
          // created from a user click on an action-suggestion, so we cite
          // the user action as the source. When the chat agent proposes
          // workflows, it supplies real sources via the artifact parser.
          sources: [{
            type: 'user' as const,
            title: 'Founder triggered from action-suggestion',
            quote: title,
          }],
        }];
      });
    } else if (action === 'trigger-workflow') {
      const steps = (payload.steps as string[]) || [];
      sendMessage(`Execute this workflow: "${payload.title}"\nSteps: ${steps.join(', ')}\n\nPlease walk me through each step with specific details and deliverables.`);
    }
  }, [sendMessage]);

  const [sidebarWidth, setSidebarWidth] = useState(420);
  const isResizingRef = useRef(false);

  // Resize handler
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const onMove = (ev: MouseEvent) => {
      if (!isResizingRef.current) {return;}
      const delta = startX - ev.clientX;
      const newWidth = Math.max(280, Math.min(800, startWidth + delta));
      setSidebarWidth(newWidth);
    };

    const onUp = () => {
      isResizingRef.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [sidebarWidth]);

  const sidebarTabs: { key: SidebarMode; label: string; count?: number }[] = useMemo(() => [
    { key: 'graph', label: 'Intelligence', count: graph.nodes.length },
    { key: 'workflows', label: 'Workflows', count: workflows.length },
    { key: 'metrics', label: 'Metrics', count: metrics.length },
    { key: 'pipeline', label: 'Pipeline', count: investors.length },
  ], [graph.nodes.length, workflows.length, metrics.length, investors.length]);

  return (
    <div className="flex h-full">
      {/* Chat — main area */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="px-4 py-2 border-b border-zinc-800 bg-zinc-950/50 flex items-center gap-3">
          <h2 className="text-sm font-medium text-white truncate">{project?.name}</h2>
          <span className="text-xs text-zinc-500">AI Workspace</span>
        </div>
        <div className="flex-1 overflow-hidden">
          <ChatPanel
            messages={messages}
            onSend={sendMessage}
            isStreaming={isStreaming}
            placeholder="What are you building?"
            emptyMessage="Tell me about your startup. I'll map the landscape, find competitors, and help you build your strategy."
            onArtifactAction={handleArtifactAction}
            onEntityDiscovered={handleEntityDiscovered}
            onWorkflowDiscovered={handleWorkflowDiscovered}
          />
        </div>
      </div>

      {/* Resize handle */}
      <div
        className="w-1 hover:w-1.5 bg-zinc-800 hover:bg-blue-500/50 cursor-col-resize shrink-0 transition-colors"
        onMouseDown={handleResizeStart}
      />

      {/* Intelligent Sidebar */}
      <div className="flex flex-col bg-zinc-950 shrink-0" style={{ width: sidebarWidth }}>
        {/* Sidebar tabs */}
        <div className="flex border-b border-zinc-800 px-2 pt-2">
          {sidebarTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setSidebarMode(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-t-lg transition-colors ${
                sidebarMode === tab.key
                  ? 'bg-zinc-900 text-white border border-zinc-800 border-b-zinc-900 -mb-px'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                  sidebarMode === tab.key ? 'bg-blue-500/20 text-blue-400' : 'bg-zinc-800 text-zinc-500'
                }`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Sidebar content */}
        <div className="flex-1 overflow-hidden relative">
          {/* Graph view */}
          {sidebarMode === 'graph' && (
            <div className="h-full relative">
              <KnowledgeGraph
                nodes={graph.nodes}
                edges={graph.edges}
                onNodeClick={setSelectedNode}
              />
              <GraphLegend activeTypes={graph.nodes.map(n => n.node_type)} />
              {selectedNode && (
                <NodeDetailPanel node={selectedNode} onClose={() => setSelectedNode(null)} />
              )}
            </div>
          )}

          {/* Metrics view */}
          {sidebarMode === 'metrics' && (
            <div className="p-4 overflow-y-auto h-full">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-white">Key Metrics</h3>
                <button
                  onClick={() => sendMessage('Show me my current metrics and runway analysis.')}
                  className="text-xs text-blue-400 hover:text-blue-300"
                >
                  Analyze
                </button>
              </div>
              {metrics.length > 0 ? (
                <div className="space-y-2">
                  {metrics.map((m, i) => (
                    <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 flex items-center justify-between">
                      <span className="text-sm text-zinc-300">{m.name}</span>
                      <div className="text-right">
                        <div className="text-sm font-medium text-white">{m.value.toLocaleString()}</div>
                        <div className={`text-xs ${m.growth.startsWith('-') ? 'text-red-400' : 'text-green-400'}`}>{m.growth}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <p className="text-zinc-500 text-sm mb-2">No metrics tracked yet</p>
                  <button
                    onClick={() => sendMessage('Help me define the key metrics I should track for my startup.')}
                    className="text-xs text-blue-400 hover:text-blue-300"
                  >
                    Ask AI to suggest metrics
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Workflows view */}
          {sidebarMode === 'workflows' && (
            <div className="p-4 overflow-y-auto h-full">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-white">Workflows</h3>
              </div>
              {workflows.length > 0 ? (
                <div className="space-y-3">
                  {['high', 'medium', 'low'].map(priority => {
                    const filtered = workflows.filter(w => w.priority === priority);
                    if (filtered.length === 0) {return null;}
                    return (
                      <div key={priority}>
                        <div className={`text-xs font-medium mb-2 ${
                          priority === 'high' ? 'text-red-400' : priority === 'medium' ? 'text-yellow-400' : 'text-zinc-500'
                        }`}>
                          {priority.toUpperCase()} PRIORITY
                        </div>
                        {filtered.map((wf, i) => (
                          <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 mb-2">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-sm font-medium text-white flex-1">{wf.title}</span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                                { hiring: 'bg-amber-500/20 text-amber-400', marketing: 'bg-blue-500/20 text-blue-400',
                                  fundraising: 'bg-green-500/20 text-green-400', product: 'bg-violet-500/20 text-violet-400',
                                  legal: 'bg-rose-500/20 text-rose-400', operations: 'bg-cyan-500/20 text-cyan-400',
                                  sales: 'bg-orange-500/20 text-orange-400' }[wf.category] || 'bg-zinc-700 text-zinc-400'
                              }`}>{wf.category}</span>
                            </div>
                            <p className="text-xs text-zinc-400 mb-2">{wf.description}</p>
                            {wf.steps && wf.steps.length > 0 && (
                              <div className="space-y-1 mb-2">
                                {wf.steps.slice(0, 4).map((step, j) => (
                                  <div key={j} className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                                    <span className="w-3 h-3 rounded border border-zinc-700 shrink-0" />
                                    {step}
                                  </div>
                                ))}
                                {wf.steps.length > 4 && (
                                  <div className="text-[11px] text-zinc-600">+{wf.steps.length - 4} more steps</div>
                                )}
                              </div>
                            )}
                            <button
                              onClick={() => {
                                sendMessage(`Execute workflow: "${wf.title}"\nSteps: ${wf.steps.join(', ')}\n\nWalk me through each step with specifics.`);
                              }}
                              className="text-xs px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors"
                            >
                              Execute
                            </button>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-12">
                  <p className="text-zinc-500 text-sm mb-2">No workflows yet</p>
                  <p className="text-zinc-600 text-xs">The AI will suggest actionable workflows as you chat</p>
                </div>
              )}
            </div>
          )}

          {/* Pipeline view */}
          {sidebarMode === 'pipeline' && (
            <div className="p-4 overflow-y-auto h-full">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-white">Investor Pipeline</h3>
                <button
                  onClick={() => sendMessage('Help me build my fundraising strategy and target investor list.')}
                  className="text-xs text-blue-400 hover:text-blue-300"
                >
                  Build List
                </button>
              </div>
              {investors.length > 0 ? (
                <div className="space-y-2">
                  {investors.map((inv, i) => (
                    <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-white">{inv.name}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          inv.stage === 'committed' ? 'bg-green-500/20 text-green-400' :
                          inv.stage === 'term_sheet' ? 'bg-blue-500/20 text-blue-400' :
                          inv.stage === 'passed' ? 'bg-red-500/20 text-red-400' :
                          'bg-zinc-700 text-zinc-400'
                        }`}>{inv.stage}</span>
                      </div>
                      {inv.check_size > 0 && (
                        <div className="text-xs text-zinc-500 mt-1">${(inv.check_size / 1000).toFixed(0)}K</div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <p className="text-zinc-500 text-sm mb-2">No investors tracked yet</p>
                  <button
                    onClick={() => sendMessage('I want to start fundraising. Help me identify the right investors for my startup.')}
                    className="text-xs text-blue-400 hover:text-blue-300"
                  >
                    Start fundraising discussion
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
