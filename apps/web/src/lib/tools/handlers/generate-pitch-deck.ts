import { v4 as uuid } from 'uuid';
import { query, run } from '@/lib/db';
import { chatJSON } from '@/lib/llm';
import type { ToolHandler } from '../types';

interface Slide {
  title: string;
  content: string;
  notes: string;
  layout: 'title' | 'content' | 'two-column' | 'image' | 'quote';
}

export const generatePitchDeck: ToolHandler = async (params, context) => {
  const slideCount = (params.slide_count as number) || 10;
  const audience = (params.audience as string) || 'investor';

  const [project] = query<{ name: string; description: string }>(
    'SELECT name, description FROM projects WHERE id = ?',
    context.projectId,
  );
  if (!project) {
    return { success: false, output: {}, error: 'Project not found' };
  }

  const [idea] = query('SELECT * FROM idea_canvas WHERE project_id = ?', context.projectId);
  const [research] = query('SELECT * FROM research WHERE project_id = ?', context.projectId);
  const [scores] = query('SELECT * FROM scores WHERE project_id = ?', context.projectId);
  const [workflow] = query('SELECT * FROM workflow WHERE project_id = ?', context.projectId);

  const projectData = {
    name: project.name,
    description: project.description,
    idea: idea || null,
    research: research || null,
    scores: scores || null,
    workflow: workflow || null,
  };

  const slides = await chatJSON<{ slides: Slide[] }>(
    [
      {
        role: 'system',
        content: `You are an expert pitch deck creator. Generate a ${slideCount}-slide pitch deck as JSON.
Audience: ${audience}
Return JSON: { "slides": [{ "title": "...", "content": "...", "notes": "...", "layout": "title|content|two-column|image|quote" }] }
Standard investor deck structure: Title, Problem, Solution, Market Size, Product, Business Model, Traction, Team, Competition, Financials, Ask, Contact.
Adapt slide count to ${slideCount}. Be specific with numbers and data from the project context.`,
      },
      {
        role: 'user',
        content: `Generate a pitch deck for:\n${JSON.stringify(projectData, null, 2)}`,
      },
    ],
    context.provider || 'openai',
  );

  // Generate HTML presentation using Reveal.js CDN
  const html = renderDeckToHtml(project.name, slides.slides);

  const draftId = `draft_${uuid().slice(0, 12)}`;
  const versionId = `dv_${uuid().slice(0, 12)}`;

  run(
    `INSERT INTO drafts (id, project_id, name, draft_type, status, current_version, created_at, updated_at)
     VALUES (?, ?, ?, 'pitch-deck', 'draft', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    draftId,
    context.projectId,
    `${project.name} Pitch Deck`,
  );

  run(
    `INSERT INTO draft_versions (id, draft_id, version_number, content, content_type, rendered_html, changelog, created_by, created_at)
     VALUES (?, ?, 1, ?, 'slides-json', ?, 'Initial generation', 'ai', CURRENT_TIMESTAMP)`,
    versionId,
    draftId,
    JSON.stringify(slides),
    html,
  );

  return {
    success: true,
    output: {
      draft_id: draftId,
      version_id: versionId,
      draft_type: 'pitch-deck',
      slide_count: slides.slides.length,
      slides: slides.slides.map((s) => s.title),
    },
    draftId,
  };
};

function renderDeckToHtml(projectName: string, slides: Slide[]): string {
  const slideHtml = slides
    .map(
      (s) => `
    <section>
      <h2>${escapeHtml(s.title)}</h2>
      <div>${escapeHtml(s.content).replace(/\n/g, '<br>')}</div>
      <aside class="notes">${escapeHtml(s.notes)}</aside>
    </section>`,
    )
    .join('\n');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(projectName)} — Pitch Deck</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reveal.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/theme/white.css">
  <style>
    .reveal h2 { font-size: 1.8em; color: #1a1a2e; }
    .reveal section { text-align: left; padding: 40px; }
    .reveal section div { font-size: 0.9em; line-height: 1.6; color: #444; }
  </style>
</head>
<body>
  <div class="reveal">
    <div class="slides">
${slideHtml}
    </div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reveal.js"></script>
  <script>Reveal.initialize({ hash: true, transition: 'slide' });</script>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
