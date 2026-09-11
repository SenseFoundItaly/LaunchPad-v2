import { v4 as uuid } from 'uuid';
import { run, get } from '@/lib/db';
import { chat } from '@/lib/llm';
import type { ToolHandler } from '../types';

interface DraftRow {
  id: string;
  project_id: string;
  name: string;
  draft_type: string;
  current_version: number;
}

interface VersionRow {
  id: string;
  content: string;
  content_type: string;
  rendered_html: string;
}

export const iterateDraft: ToolHandler = async (params, context) => {
  const draftId = (params.draft_id as string) || context.draftId;
  const feedback = params.feedback as string;

  if (!draftId || !feedback) {
    return { success: false, output: {}, error: 'draft_id and feedback are required' };
  }

  const draft = get<DraftRow>('SELECT * FROM drafts WHERE id = ?', draftId);
  if (!draft) {
    return { success: false, output: {}, error: `Draft not found: ${draftId}` };
  }

  // Get current version
  const currentVersion = get<VersionRow>(
    'SELECT * FROM draft_versions WHERE draft_id = ? AND version_number = ?',
    draftId,
    draft.current_version,
  );
  if (!currentVersion) {
    return { success: false, output: {}, error: 'Current version not found' };
  }

  const content = JSON.parse(currentVersion.content);
  const currentHtml = currentVersion.rendered_html || content.html || '';

  const messages = [
    {
      role: 'system' as const,
      content: `You are an expert web designer iterating on a ${draft.draft_type}.
You will receive the current HTML and user feedback.
Apply the feedback and return the COMPLETE updated HTML.
Output ONLY raw HTML — no markdown fences, no explanation.
Preserve the overall structure and design unless the feedback specifically asks to change it.
Make surgical, targeted improvements based on the feedback.`,
    },
    {
      role: 'user' as const,
      content: `Current HTML:\n${currentHtml}\n\nFeedback:\n${feedback}\n\nReturn the updated HTML:`,
    },
  ];

  const newHtml = await chat(messages, context.provider || 'openai', 0.7, 8192);

  let cleanHtml = newHtml.trim();
  cleanHtml = cleanHtml.replace(/^```(?:html)?\s*/, '').replace(/\s*```$/, '');

  const newVersionNumber = draft.current_version + 1;
  const versionId = `dv_${uuid().slice(0, 12)}`;

  run(
    `INSERT INTO draft_versions (id, draft_id, version_number, content, content_type, rendered_html, changelog, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'ai', CURRENT_TIMESTAMP)`,
    versionId,
    draftId,
    newVersionNumber,
    JSON.stringify({ ...content, html: cleanHtml }),
    currentVersion.content_type,
    cleanHtml,
    feedback,
  );

  run(
    'UPDATE drafts SET current_version = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    newVersionNumber,
    draftId,
  );

  return {
    success: true,
    output: {
      draft_id: draftId,
      version_id: versionId,
      version_number: newVersionNumber,
      changelog: feedback,
    },
    draftId,
  };
};
