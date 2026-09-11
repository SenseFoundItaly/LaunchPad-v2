import { v4 as uuid } from 'uuid';
import { query, run } from '@/lib/db';
import { chat } from '@/lib/llm';
import type { ToolHandler } from '../types';

export const generateOnePager: ToolHandler = async (params, context) => {
  const format = (params.format as string) || 'investor';

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

  const projectData = {
    name: project.name,
    description: project.description,
    idea: idea || null,
    research: research || null,
    scores: scores || null,
  };

  const formatInstructions: Record<string, string> = {
    investor:
      'Focus on: market size, traction, team, competitive advantage, and the ask. Include key metrics.',
    partner:
      'Focus on: product capabilities, integration opportunities, mutual value, and partnership terms.',
    press:
      'Focus on: the story, market impact, founder journey, and quotable highlights.',
  };

  const messages = [
    {
      role: 'system' as const,
      content: `You are an expert startup communications designer. Generate a professional one-page startup summary as self-contained HTML.
Output ONLY raw HTML — no markdown fences, no explanation.
Use inline CSS with a clean, professional design. Use Google Fonts CDN.
Format: ${format}
${formatInstructions[format] || formatInstructions.investor}

Layout: A4-proportioned single page with:
- Company name and tagline at the top
- 2-3 column grid layout for key sections
- Key metrics prominently displayed
- Clear visual hierarchy
- Professional color scheme (dark navy + accent color)
- Print-friendly (fits on one page when printed)`,
    },
    {
      role: 'user' as const,
      content: `Generate a one-pager for:\n${JSON.stringify(projectData, null, 2)}`,
    },
  ];

  const html = await chat(messages, context.provider || 'openai', 0.7, 8192);

  let cleanHtml = html.trim();
  cleanHtml = cleanHtml.replace(/^```(?:html)?\s*/, '').replace(/\s*```$/, '');

  const draftId = `draft_${uuid().slice(0, 12)}`;
  const versionId = `dv_${uuid().slice(0, 12)}`;

  run(
    `INSERT INTO drafts (id, project_id, name, draft_type, status, current_version, created_at, updated_at)
     VALUES (?, ?, ?, 'one-pager', 'draft', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    draftId,
    context.projectId,
    `${project.name} One-Pager (${format})`,
  );

  run(
    `INSERT INTO draft_versions (id, draft_id, version_number, content, content_type, rendered_html, changelog, created_by, created_at)
     VALUES (?, ?, 1, ?, 'html', ?, 'Initial generation', 'ai', CURRENT_TIMESTAMP)`,
    versionId,
    draftId,
    JSON.stringify({ html: cleanHtml, format }),
    cleanHtml,
  );

  return {
    success: true,
    output: {
      draft_id: draftId,
      version_id: versionId,
      draft_type: 'one-pager',
      format,
    },
    draftId,
  };
};
