import api from './index';
import type { ApiResponse, Project } from '@/types';

export async function listProjects(): Promise<Project[]> {
  const { data } = await api.get<ApiResponse<Project[]>>('/api/projects');
  return data.data;
}

export async function createProject(name: string, description: string = ''): Promise<Project> {
  const { data } = await api.post<ApiResponse<Project>>('/api/projects', { name, description });
  return data.data;
}

export async function getProject(projectId: string): Promise<Project> {
  const { data } = await api.get<ApiResponse<Project>>(`/api/projects/${projectId}`);
  return data.data;
}

export async function deleteProject(projectId: string): Promise<void> {
  await api.delete(`/api/projects/${projectId}`);
}

export async function getStepData<T>(projectId: string, stepName: string): Promise<T | null> {
  const { data } = await api.get<ApiResponse<T | null>>(`/api/projects/${projectId}/step/${stepName}`);
  return data.data;
}
