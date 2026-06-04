'use client';

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/api';
import type { KnowledgeGraphData, GraphNode, GraphEdge } from '@/types/graph';

const EMPTY: KnowledgeGraphData = { nodes: [], edges: [] };

export function useKnowledgeGraph(projectId: string) {
  const qc = useQueryClient();
  // Keys are recreated each render, but TanStack normalizes via structural
  // sharing. We deliberately don't memoize so projectId changes work cleanly.
  const key = ['knowledge', projectId, 'graph'] as const;

  const { data, isLoading } = useQuery<KnowledgeGraphData>({
    queryKey: key,
    enabled: !!projectId,
    queryFn: async () => {
      const { data } = await api.get(`/api/graph/${projectId}`);
      return data?.success ? data.data : EMPTY;
    },
  });

  const graph = data ?? EMPTY;

  // Optimistic add — reads via qc.getQueryData inside the callback so we
  // never close over a stale snapshot. The event bridge may invalidate this
  // query mid-flight (e.g. concurrent KnowledgeReviewList apply); the
  // setQueryData updaters re-run against whatever cache exists at the
  // moment they fire, so we don't drop the optimistic temp node.
  const addNode = useCallback(
    async (node: Omit<GraphNode, 'id'>) => {
      const nameLower = node.name.trim().toLowerCase();
      const current = qc.getQueryData<KnowledgeGraphData>([...key]) ?? EMPTY;
      const existing = current.nodes.find(
        (n) => n.name.trim().toLowerCase() === nameLower,
      );
      if (existing) return existing;

      const tempId = `gn_temp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const newNode = { ...node, id: tempId } as GraphNode;
      qc.setQueryData<KnowledgeGraphData>([...key], (prev) => {
        const base = prev ?? EMPTY;
        return {
          ...base,
          nodes: [
            ...base.nodes.filter(
              (n) => n.name.trim().toLowerCase() !== nameLower,
            ),
            newNode,
          ],
        };
      });
      try {
        const { data } = await api.post(`/api/graph/${projectId}/nodes`, node);
        if (data?.success) {
          const real = data.data as GraphNode;
          qc.setQueryData<KnowledgeGraphData>([...key], (prev) => {
            const base = prev ?? EMPTY;
            // If a mid-flight invalidate already refetched and tempId is gone,
            // append the real node (server is the source of truth anyway).
            const hasTemp = base.nodes.some((n) => n.id === tempId);
            if (hasTemp) {
              return { ...base, nodes: base.nodes.map((n) => (n.id === tempId ? real : n)) };
            }
            const hasReal = base.nodes.some((n) => n.id === real.id);
            return hasReal ? base : { ...base, nodes: [...base.nodes, real] };
          });
          return real;
        }
      } catch {
        /* keep optimistic */
      }
      return newNode;
    },
    // `key` is structurally identical across renders (same projectId →
    // same array), and TanStack handles deep equality internally. Listing
    // only the primitive keeps the callback identity stable.
    [projectId, qc],
  );

  const addEdge = useCallback(
    async (edge: Omit<GraphEdge, 'id'>) => {
      const tempId = `ge_temp_${Date.now()}`;
      qc.setQueryData<KnowledgeGraphData>([...key], (prev) => {
        const base = prev ?? EMPTY;
        return { ...base, edges: [...base.edges, { ...edge, id: tempId } as GraphEdge] };
      });
      try {
        const payload = {
          source_node_id: typeof edge.source === 'string' ? edge.source : edge.source.id,
          target_node_id: typeof edge.target === 'string' ? edge.target : edge.target.id,
          relation: edge.relation,
          label: edge.label,
          weight: edge.weight,
        };
        const { data } = await api.post(`/api/graph/${projectId}/edges`, payload);
        if (data?.success) {
          const real = data.data as GraphEdge;
          qc.setQueryData<KnowledgeGraphData>([...key], (prev) => {
            const base = prev ?? EMPTY;
            const hasTemp = base.edges.some((e) => e.id === tempId);
            if (hasTemp) {
              return { ...base, edges: base.edges.map((e) => (e.id === tempId ? real : e)) };
            }
            const hasReal = base.edges.some((e) => e.id === real.id);
            return hasReal ? base : { ...base, edges: [...base.edges, real] };
          });
        }
      } catch {
        /* keep optimistic */
      }
    },
    // `key` is structurally identical across renders (same projectId →
    // same array), and TanStack handles deep equality internally. Listing
    // only the primitive keeps the callback identity stable.
    [projectId, qc],
  );

  return { graph, loading: isLoading, addNode, addEdge };
}
