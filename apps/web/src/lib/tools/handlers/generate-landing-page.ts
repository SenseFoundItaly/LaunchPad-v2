import { v4 as uuid } from 'uuid';
import { query, run } from '@/lib/db';
import { chat } from '@/lib/llm';
import type { ToolHandler } from '../types';

export const generateLandingPage: ToolHandler = async (params, context) => {
  const style = (params.style as string) || 'modern';
  const includeCta = params.include_cta !== false;

  // Gather project data
  const [project] = query<{ name: string; description: string }>(
    'SELECT name, description FROM projects WHERE id = ?',
    context.projectId,
  );
  if (!project) {
    return { success: false, output: {}, error: 'Project not found' };
  }

  const [idea] = query(
    'SELECT * FROM idea_canvas WHERE project_id = ?',
    context.projectId,
  );

  const [research] = query(
    'SELECT * FROM research WHERE project_id = ?',
    context.projectId,
  );

  const [scores] = query(
    'SELECT * FROM scores WHERE project_id = ?',
    context.projectId,
  );

  const projectData = {
    name: project.name,
    description: project.description,
    idea: idea || null,
    research: research || null,
    scores: scores || null,
  };

  const messages = [
    {
      role: 'system' as const,
      content: `You are an expert web designer. Generate a complete, production-ready single-page HTML landing page.
Output ONLY the raw HTML — no markdown fences, no explanation.
The HTML must be self-contained with inline CSS (using a <style> tag) and minimal inline JS if needed.
Use Google Fonts CDN and Tailwind CSS CDN for styling.
Style: ${style}
${includeCta ? 'Include an email signup CTA form.' : 'No signup form needed.'}

Design requirements:
- Hero section with compelling headline and value proposition
- Problem/solution section
- Key features or benefits (3-4 items)
- Social proof section (placeholder testimonials)
- ${includeCta ? 'Email signup CTA' : 'Learn more CTA'}
- Clean, professional footer
- Fully responsive (mobile-first)
- Modern, clean aesthetic`,
    },
    {
      role: 'user' as const,
      content: `Generate a landing page for this startup:\n${JSON.stringify(projectData, null, 2)}`,
    },
  ];

  const html = await chat(messages, context.provider || 'openai', 0.7, 8192);

  // Clean the response — strip any markdown fences if the LLM added them
  let cleanHtml = html.trim();
  cleanHtml = cleanHtml.replace(/^```(?:html)?\s*/, '').replace(/\s*```$/, '');

  // Create draft
  const draftId = `draft_${uuid().slice(0, 12)}`;
  const versionId = `dv_${uuid().slice(0, 12)}`;

  run(
    `INSERT INTO drafts (id, project_id, name, draft_type, status, current_version, created_at, updated_at)
     VALUES (?, ?, ?, 'landing-page', 'draft', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    draftId,
    context.projectId,
    `${project.name} Landing Page`,
  );

  run(
    `INSERT INTO draft_versions (id, draft_id, version_number, content, content_type, rendered_html, changelog, created_by, created_at)
     VALUES (?, ?, 1, ?, 'html', ?, 'Initial generation', 'ai', CURRENT_TIMESTAMP)`,
    versionId,
    draftId,
    JSON.stringify({ html: cleanHtml, style, include_cta: includeCta }),
    cleanHtml,
  );

  return {
    success: true,
    output: {
      draft_id: draftId,
      version_id: versionId,
      draft_type: 'landing-page',
      preview: cleanHtml.slice(0, 500) + '...',
    },
    draftId,
  };
};
