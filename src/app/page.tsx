'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/api';
import SignalCard from '@/components/home/SignalCard';
import ProjectCard from '@/components/home/ProjectCard';

interface DashboardProject {
  project_id: string;
  name: string;
  description: string;
  skills_completed: number;
  total_skills: number;
  weekly_alerts: number;
  created_at: string;
}

interface DashboardSignal {
  id: string;
  project_id: string;
  project_name: string;
  severity: string;
  message: string;
  created_at: string;
}

interface DashboardStats {
  total_projects: number;
  total_skills_completed: number;
  total_alerts_this_week: number;
}

export default function HomePage() {
  const router = useRouter();
  const [projects, setProjects] = useState<DashboardProject[]>([]);
  const [signals, setSignals] = useState<DashboardSignal[]>([]);
  const [stats, setStats] = useState<DashboardStats>({ total_projects: 0, total_skills_completed: 0, total_alerts_this_week: 0 });
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

  const fetchData = useCallback(async () => {
    try {
      const { data } = await api.get('/api/dashboard');
      if (data.success && data.data) {
        setProjects(data.data.projects || []);
        setSignals(data.data.signals || []);
        setStats(data.data.stats || { total_projects: 0, total_skills_completed: 0, total_alerts_this_week: 0 });
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const { data } = await api.post('/api/projects', { name: newName.trim(), description: newDesc.trim() });
      if (data.success && data.data) {
        router.push(`/project/${data.data.project_id || data.data.id}/chat`);
      }
    } catch { /* ignore */ }
    setCreating(false);
  }

  const [showCreate, setShowCreate] = useState(false);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500 text-sm">Loading...</div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">LaunchPad</h1>
            <p className="text-sm text-zinc-500 mt-1">
              {stats.total_projects} project{stats.total_projects !== 1 ? 's' : ''} | {stats.total_skills_completed} skills completed | {stats.total_alerts_this_week} signals this week
            </p>
          </div>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            New Project
          </button>
        </div>

        {/* Create project form */}
        {showCreate && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 mb-6">
            <div className="flex gap-3">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Project name"
                className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-500"
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              />
              <input
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="Description (optional)"
                className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-500"
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              />
              <button
                onClick={handleCreate}
                disabled={creating || !newName.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white text-sm rounded-lg transition-colors"
              >
                {creating ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        )}

        {/* Signals Feed */}
        {signals.length > 0 && (
          <div className="mb-8">
            <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">Recent Signals</h2>
            <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin">
              {signals.map((s) => (
                <SignalCard
                  key={s.id}
                  severity={s.severity}
                  projectName={s.project_name}
                  message={s.message}
                  createdAt={s.created_at}
                />
              ))}
            </div>
          </div>
        )}

        {/* Projects Grid */}
        {projects.length > 0 ? (
          <div>
            <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">Projects</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {projects.map((p) => (
                <ProjectCard
                  key={p.project_id}
                  projectId={p.project_id}
                  name={p.name}
                  description={p.description}
                  skillsCompleted={p.skills_completed}
                  totalSkills={p.total_skills}
                  weeklyAlerts={p.weekly_alerts}
                  createdAt={p.created_at}
                />
              ))}
            </div>
          </div>
        ) : (
          !showCreate && (
            <div className="text-center py-16">
              <h3 className="text-lg text-zinc-400 mb-2">No projects yet</h3>
              <p className="text-sm text-zinc-600 mb-4">Create your first project to start validating your startup idea</p>
              <button
                onClick={() => setShowCreate(true)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors"
              >
                Create Project
              </button>
            </div>
          )
        )}
      </div>
    </div>
  );
}
