'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import api from '@/api';
import type { Task, ApiResponse } from '@/types';

export function useTaskPolling(taskId: string | null, interval: number = 2000) {
  const [task, setTask] = useState<Task | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsPolling(false);
  }, []);

  const poll = useCallback(async () => {
    if (!taskId) {return;}
    try {
      const { data } = await api.get<ApiResponse<Task>>(`/api/tasks/${taskId}`);
      setTask(data.data);
      if (data.data.status === 'completed' || data.data.status === 'failed') {
        stopPolling();
      }
    } catch (err) {
      console.error('Polling error:', err);
      stopPolling();
    }
  }, [taskId, stopPolling]);

  useEffect(() => {
    if (!taskId) {return;}
    setIsPolling(true);
    poll();
    intervalRef.current = setInterval(poll, interval);
    return () => stopPolling();
  }, [taskId, interval, poll, stopPolling]);

  return { task, isPolling };
}
