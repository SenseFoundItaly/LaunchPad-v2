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
        <div className="px-4 py-2 border-b border-line bg-paper/50 flex items-center gap-3">
          <h2 className="text-sm font-medium text-ink truncate">{project?.name}</h2>
          <span className="text-xs text-ink-5">AI Workspace</span>
        </div>
        <div className="flex-1 overflow-hidden">
          <ChatPanel
            messages={messages}
            onSend={sendMessage}
            isStreaming={isStreaming}
            placeholder="What assumption should we test next?"
            emptyMessage="Describe your idea. I'll map the landscape, surface competitors, and stress-test your assumptions — so you find fatal flaws early."
            onArtifactAction={handleArtifactAction}
            onEntityDiscovered={handleEntityDiscovered}
            onWorkflowDiscovered={handleWorkflowDiscovered}
          />
        </div>
      </div>

      {/* Resize handle */}
      <div
        className="w-1 hover:w-1.5 bg-paper-3 hover:bg-moss/50 cursor-col-resize shrink-0 transition-colors"
        onMouseDown={handleResizeStart}
      />

      {/* Intelligent Sidebar */}
      <div className="flex flex-col bg-paper shrink-0" style={{ width: sidebarWidth }}>
        {/* Sidebar tabs */}
        <div className="flex border-b border-line px-2 pt-2">
          {sidebarTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setSidebarMode(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-t-lg transition-colors ${
                sidebarMode === tab.key
                  ? 'bg-paper-2 text-ink border border-line border-b-paper-2 -mb-px'
                  : 'text-ink-5 hover:text-ink-3'
              }`}
            >
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                  sidebarMode === tab.key ? 'bg-sky-wash text-sky' : 'bg-paper-3 text-ink-5'
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
                <h3 className="text-sm font-medium text-ink">Key Metrics</h3>
                <button
                  onClick={() => sendMessage('Show me my current metrics and runway analysis.')}
                  className="text-xs text-sky hover:text-sky"
                >
                  Analyze
                </button>
              </div>
              {metrics.length > 0 ? (
                <div className="space-y-2">
                  {metrics.map((m, i) => (
                    <div key={i} className="bg-paper-2 border border-line rounded-lg p-3 flex items-center justify-between">
                      <span className="text-sm text-ink-3">{m.name}</span>
                      <div className="text-right">
                        <div className="text-sm font-medium text-ink">{m.value.toLocaleString()}</div>
                        <div className={`text-xs ${m.growth.startsWith('-') ? 'text-clay' : 'text-moss'}`}>{m.growth}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <p className="text-ink-5 text-sm mb-2">No metrics tracked yet</p>
                  <button
                    onClick={() => sendMessage('Help me define the key metrics I should track for my startup.')}
                    className="text-xs text-sky hover:text-sky"
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
                <h3 className="text-sm font-medium text-ink">Workflows</h3>
              </div>
              {workflows.length > 0 ? (
                <div className="space-y-3">
                  {['high', 'medium', 'low'].map(priority => {
                    const filtered = workflows.filter(w => w.priority === priority);
                    if (filtered.length === 0) {return null;}
                    return (
                      <div key={priority}>
                        <div className={`text-xs font-medium mb-2 ${
                          priority === 'high' ? 'text-clay' : priority === 'medium' ? 'text-accent' : 'text-ink-5'
                        }`}>
                          {priority.toUpperCase()} PRIORITY
                        </div>
                        {filtered.map((wf, i) => (
                          <div key={i} className="bg-paper-2 border border-line rounded-lg p-3 mb-2">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-sm font-medium text-ink flex-1">{wf.title}</span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                                { hiring: 'bg-accent-wash text-accent', marketing: 'bg-sky-wash text-sky',
                                  fundraising: 'bg-moss-wash text-moss', product: 'bg-plum-wash text-plum',
                                  legal: 'bg-cat-rose-wash text-cat-rose', operations: 'bg-cat-teal-wash text-cat-teal',
                                  sales: 'bg-cat-gold-wash text-cat-gold' }[wf.category] || 'bg-ink-6 text-ink-4'
                              }`}>{wf.category}</span>
                            </div>
                            <p className="text-xs text-ink-4 mb-2">{wf.description}</p>
                            {wf.steps && wf.steps.length > 0 && (
                              <div className="space-y-1 mb-2">
                                {wf.steps.slice(0, 4).map((step, j) => (
                                  <div key={j} className="flex items-center gap-1.5 text-[11px] text-ink-5">
                                    <span className="w-3 h-3 rounded border border-line-2 shrink-0" />
                                    {step}
                                  </div>
                                ))}
                                {wf.steps.length > 4 && (
                                  <div className="text-[11px] text-ink-6">+{wf.steps.length - 4} more steps</div>
                                )}
                              </div>
                            )}
                            <button
                              onClick={() => {
                                sendMessage(`Execute workflow: "${wf.title}"\nSteps: ${wf.steps.join(', ')}\n\nWalk me through each step with specifics.`);
                              }}
                              className="text-xs px-3 py-1 bg-moss hover:bg-moss/80 text-on-accent rounded-md transition-colors"
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
                  <p className="text-ink-5 text-sm mb-2">No workflows yet</p>
                  <p className="text-ink-6 text-xs">The AI will suggest actionable workflows as you chat</p>
                </div>
              )}
            </div>
          )}

          {/* Pipeline view */}
          {sidebarMode === 'pipeline' && (
            <div className="p-4 overflow-y-auto h-full">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-ink">Investor Pipeline</h3>
                <button
                  onClick={() => sendMessage('Help me build my fundraising strategy and target investor list.')}
                  className="text-xs text-sky hover:text-sky"
                >
                  Build List
                </button>
              </div>
              {investors.length > 0 ? (
                <div className="space-y-2">
                  {investors.map((inv, i) => (
                    <div key={i} className="bg-paper-2 border border-line rounded-lg p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-ink">{inv.name}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          inv.stage === 'committed' ? 'bg-moss-wash text-moss' :
                          inv.stage === 'term_sheet' ? 'bg-sky-wash text-sky' :
                          inv.stage === 'passed' ? 'bg-clay-wash text-clay' :
                          'bg-ink-6 text-ink-4'
                        }`}>{inv.stage}</span>
                      </div>
                      {inv.check_size > 0 && (
                        <div className="text-xs text-ink-5 mt-1">${(inv.check_size / 1000).toFixed(0)}K</div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <p className="text-ink-5 text-sm mb-2">No investors tracked yet</p>
                  <button
                    onClick={() => sendMessage('I want to start fundraising. Help me identify the right investors for my startup.')}
                    className="text-xs text-sky hover:text-sky"
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
