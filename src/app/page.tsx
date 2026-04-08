'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { listProjects, createProject, deleteProject } from '@/api/projects';
import type { Project } from '@/types';

export default function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const router = useRouter();

  useEffect(() => {
    loadProjects();
  }, []);

  async function loadProjects() {
    try {
      const data = await listProjects();
      setProjects(data);
    } catch (err) {
      console.error('Failed to load projects:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    if (!newName.trim()) {return;}
    try {
      const project = await createProject(newName.trim(), newDesc.trim());
      router.push(`/project/${project.project_id}/idea`);
    } catch (err) {
      console.error('Failed to create project:', err);
    }
  }

  async function handleDelete(e: React.MouseEvent, projectId: string) {
    e.stopPropagation();
    if (!confirm('Delete this project?')) {return;}
    await deleteProject(projectId);
    loadProjects();
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'workflow_complete': return 'bg-green-500/20 text-green-400';
      case 'simulated': return 'bg-purple-500/20 text-purple-400';
      case 'researched': return 'bg-cyan-500/20 text-cyan-400';
      case 'scored': return 'bg-yellow-500/20 text-yellow-400';
      case 'idea_shaped': return 'bg-blue-500/20 text-blue-400';
      default: return 'bg-zinc-500/20 text-zinc-400';
    }
  };

  const stepLabels = ['', 'Chat', 'Idea Validation', 'Market Validation', 'Business Model', 'Build & Launch', 'Fundraise', 'Operate'];
  const stepPaths = ['', 'chat', 'scoring', 'research', 'chat', 'growth', 'fundraising', 'dashboard'];

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">LaunchPad</h1>
            <p className="text-zinc-400 text-sm mt-1">Shape, evaluate, and launch your startup idea</p>
          </div>
          <button
            onClick={() => setShowNew(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
          >
            + New Project
          </button>
        </div>

        {showNew && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-6">
            <h2 className="text-lg font-semibold text-white mb-4">New Startup Project</h2>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Project name (e.g., AI-powered meal planner)"
              className="w-full bg-zinc-800 text-zinc-200 rounded-lg px-4 py-2.5 text-sm border border-zinc-700 focus:border-blue-500 focus:outline-none mb-3 placeholder:text-zinc-500"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
            <textarea
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Brief description (optional)"
              rows={2}
              className="w-full bg-zinc-800 text-zinc-200 rounded-lg px-4 py-2.5 text-sm border border-zinc-700 focus:border-blue-500 focus:outline-none mb-4 placeholder:text-zinc-500 resize-none"
            />
            <div className="flex gap-2">
              <button
                onClick={handleCreate}
                disabled={!newName.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white rounded-lg text-sm font-medium transition-colors"
              >
                Create & Start
              </button>
              <button
                onClick={() => { setShowNew(false); setNewName(''); setNewDesc(''); }}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-zinc-500 text-sm">Loading projects...</div>
        ) : projects.length === 0 && !showNew ? (
          <div className="text-center py-20">
            <p className="text-zinc-500 text-lg mb-2">No projects yet</p>
            <p className="text-zinc-600 text-sm">Create one to get started.</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {projects.map((project) => (
              <div
                key={project.project_id}
                onClick={() => router.push(`/project/${project.project_id}/${stepPaths[project.current_step] || 'chat'}`)}
                className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 cursor-pointer hover:border-zinc-700 transition-colors group"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-white font-medium group-hover:text-blue-400 transition-colors">
                      {project.name}
                    </h3>
                    {project.description && (
                      <p className="text-zinc-500 text-sm mt-1">{project.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-1 rounded-full ${getStatusColor(project.status)}`}>
                      Step {project.current_step}: {stepLabels[project.current_step]}
                    </span>
                    <button
                      onClick={(e) => handleDelete(e, project.project_id)}
                      className="text-zinc-600 hover:text-red-400 text-sm opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <div className="flex gap-1 mt-3">
                  {[1, 2, 3, 4, 5].map((step) => (
                    <div
                      key={step}
                      className={`h-1 flex-1 rounded-full ${step <= project.current_step ? 'bg-blue-500' : 'bg-zinc-800'}`}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
