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
      case 'workflow_complete': return 'bg-moss-wash text-moss';
      case 'simulated': return 'bg-plum-wash text-plum';
      case 'researched': return 'bg-cat-teal-wash text-cat-teal';
      case 'scored': return 'bg-accent-wash text-accent';
      case 'idea_shaped': return 'bg-sky-wash text-sky';
      default: return 'bg-ink-5/20 text-ink-4';
    }
  };

  const stepLabels = ['', 'Idea', 'Score', 'Evidence', 'Stress Test', 'Action Plan'];
  const stepPaths = ['', 'idea', 'scoring', 'research', 'simulation', 'workflow'];

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-ink">SenseFound</h1>
            <p className="text-ink-4 text-sm mt-1">Courage Through Clarity — validate before you build</p>
          </div>
          <button
            onClick={() => setShowNew(true)}
            className="px-4 py-2 bg-moss hover:bg-moss/80 text-on-accent rounded-lg text-sm font-medium transition-colors"
          >
            + New Validation
          </button>
        </div>

        {showNew && (
          <div className="bg-paper-2 border border-line rounded-xl p-6 mb-6">
            <h2 className="text-lg font-semibold text-ink mb-4">New Validation Project</h2>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Idea to validate (e.g., AI-powered meal planner)"
              className="w-full bg-paper-3 text-ink-2 rounded-lg px-4 py-2.5 text-sm border border-line-2 focus:border-moss focus:outline-none mb-3 placeholder:text-ink-5"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
            <textarea
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Brief description (optional)"
              rows={2}
              className="w-full bg-paper-3 text-ink-2 rounded-lg px-4 py-2.5 text-sm border border-line-2 focus:border-moss focus:outline-none mb-4 placeholder:text-ink-5 resize-none"
            />
            <div className="flex gap-2">
              <button
                onClick={handleCreate}
                disabled={!newName.trim()}
                className="px-4 py-2 bg-moss hover:bg-moss/80 disabled:bg-paper-3 text-on-accent rounded-lg text-sm font-medium transition-colors"
              >
                Begin Validation
              </button>
              <button
                onClick={() => { setShowNew(false); setNewName(''); setNewDesc(''); }}
                className="px-4 py-2 bg-paper-3 hover:bg-ink-6 text-ink-3 rounded-lg text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-ink-5 text-sm">Loading projects...</div>
        ) : projects.length === 0 && !showNew ? (
          <div className="text-center py-20">
            <p className="text-ink-5 text-lg mb-2">No ideas under validation</p>
            <p className="text-ink-6 text-sm">Start a project to stress-test your assumptions with evidence.</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {projects.map((project) => (
              <div
                key={project.project_id}
                onClick={() => router.push(`/project/${project.project_id}/${stepPaths[project.current_step] || 'idea'}`)}
                className="bg-paper-2 border border-line rounded-xl p-5 cursor-pointer hover:border-line-2 transition-colors group"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-ink font-medium group-hover:text-sky transition-colors">
                      {project.name}
                    </h3>
                    {project.description && (
                      <p className="text-ink-5 text-sm mt-1">{project.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-1 rounded-full ${getStatusColor(project.status)}`}>
                      Step {project.current_step}: {stepLabels[project.current_step]}
                    </span>
                    <button
                      onClick={(e) => handleDelete(e, project.project_id)}
                      className="text-ink-6 hover:text-clay text-sm opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <div className="flex gap-1 mt-3">
                  {[1, 2, 3, 4, 5].map((step) => (
                    <div
                      key={step}
                      className={`h-1 flex-1 rounded-full ${step <= project.current_step ? 'bg-moss' : 'bg-paper-3'}`}
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
