'use client';

import { useState, useEffect, useCallback } from 'react';
import api from '@/api';
import type { KnowledgeGraphData, GraphNode, GraphEdge } from '@/types/graph';

export function useKnowledgeGraph(projectId: string) {
  const [graph, setGraph] = useState<KnowledgeGraphData>({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(true);

  // Load graph on mount
  useEffect(() => {
    api
      .get(`/api/graph/${projectId}`)
      .then(({ data }) => {
        if (data.success) {setGraph(data.data);}
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId]);

  // Add node (optimistic + persist, dedup by name case-insensitive)
  const addNode = useCallback(
    async (node: Omit<GraphNode, 'id'>) => {
      const nameLower = node.name.trim().toLowerCase();

      // Check if already exists — return existing if so
      const existing = graph.nodes.find(n => n.name.trim().toLowerCase() === nameLower);
      if (existing) {return existing;}

      const tempId = `gn_temp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const newNode = { ...node, id: tempId } as GraphNode;
      setGraph((prev) => ({
        ...prev,
        nodes: [...prev.nodes.filter(n => n.name.trim().toLowerCase() !== nameLower), newNode],
      }));
      try {
        const { data } = await api.post(`/api/graph/${projectId}/nodes`, node);
        if (data.success) {
          setGraph((prev) => ({
            ...prev,
            nodes: prev.nodes.map(n => n.id === tempId ? data.data : n),
          }));
          return data.data as GraphNode;
        }
      } catch {
        /* keep optimistic */
      }
      return newNode;
    },
    [projectId, graph.nodes],
  );

  // Add edge (optimistic + persist)
  const addEdge = useCallback(
    async (edge: Omit<GraphEdge, 'id'>) => {
      const tempId = `ge_temp_${Date.now()}`;
      setGraph((prev) => ({
        ...prev,
        edges: [...prev.edges, { ...edge, id: tempId } as GraphEdge],
      }));
      try {
        // Map GraphEdge source/target to API's source_node_id/target_node_id
        const payload = {
          source_node_id: typeof edge.source === 'string' ? edge.source : edge.source.id,
          target_node_id: typeof edge.target === 'string' ? edge.target : edge.target.id,
          relation: edge.relation,
          label: edge.label,
          weight: edge.weight,
        };
        const { data } = await api.post(`/api/graph/${projectId}/edges`, payload);
        if (data.success) {
          setGraph((prev) => ({
            ...prev,
            edges: prev.edges.map((e) => (e.id === tempId ? data.data : e)),
          }));
        }
      } catch {
        /* keep optimistic */
      }
    },
    [projectId],
  );

  return { graph, loading, addNode, addEdge };
}
