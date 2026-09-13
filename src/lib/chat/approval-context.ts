import { query } from '@/lib/db';

/** A successful apply happens outside the model turn. Supply its server result
 * explicitly, so the earlier assistant's "still pending" wording cannot win. */
export async function loadApprovalContext(projectId: string): Promise<string> {
  const rows = await query<{ id: string; payload: unknown }>(
    `SELECT id, COALESCE(edited_payload, payload) AS payload FROM pending_actions
     WHERE project_id = ? AND action_type = 'validation_proposal' AND status = 'sent'
     ORDER BY updated_at DESC, id DESC LIMIT 5`, projectId,
  );
  const approvals = rows.flatMap(row => {
    let payload = row.payload;
    if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch { return []; } }
    const items = (payload as { items?: Array<{ kind?: string; field?: string }> } | null)?.items;
    if (!Array.isArray(items)) return [];
    const fields = items.filter(i => i.kind === 'canvas_field' && /^[a-z_]+$/.test(i.field ?? '')).map(i => i.field);
    return fields.length ? [`- Proposal ${row.id}: founder applied ${fields.join(', ')} successfully.`] : [];
  });
  return approvals.length ? [
    '[CONFIRMED FOUNDER APPROVALS — server execution results]',
    ...approvals,
    'These are historical successful approvals, not proof that those values remain current. The CURRENT IDEA CANVAS is authoritative: later edits, removals and pivots supersede these approvals. Report current values only from live saved state; never restore an old value or claim a cleared field is still saved from this history. Do not ask to apply an already completed proposal again. Saved hypotheses are not market validation.',
    '',
  ].join('\n') : '';
}
