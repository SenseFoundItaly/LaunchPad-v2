import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * DEV-ONLY project browser. Lists every project across all owners with a
 * one-click deep-link that logs you in (via /api/dev-login) AS that project's
 * owner and opens it — so you can view any project locally without juggling
 * accounts. Read-only: no ownership is changed.
 *
 * Inert in production: 403 unless E2E_AUTH_ENABLED=1 (never set on the deployed
 * site), exactly like /api/dev-login.
 */
interface Row {
  id: string;
  name: string | null;
  owner_user_id: string | null;
  email: string | null;
  current_step: number | null;
  created_at: string;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function GET() {
  if (process.env.E2E_AUTH_ENABLED !== '1') {
    return NextResponse.json(
      { error: 'dev-projects is disabled (set E2E_AUTH_ENABLED=1 to use it locally)' },
      { status: 403 },
    );
  }

  const rows = await query<Row>(
    `SELECT p.id, p.name, p.owner_user_id, p.current_step, p.created_at, us.email
       FROM projects p
       LEFT JOIN users us ON us.id = p.owner_user_id
      WHERE p.status IS DISTINCT FROM 'archived'
      ORDER BY (us.email = 'hello@supalabs.co') DESC NULLS LAST, us.email, p.created_at DESC`,
  );

  // Group by owner email so the list is scannable.
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = r.email || '(no owner)';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const section = (email: string, items: Row[]) => `
    <h2>${esc(email)} <span class="n">${items.length}</span></h2>
    <ul>
      ${items
        .map((r) => {
          const to = `/project/${r.id}`;
          const href = r.owner_user_id
            ? `/api/dev-login?as=${encodeURIComponent(r.owner_user_id)}&to=${encodeURIComponent(to)}`
            : '#';
          const date = r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : '';
          return `<li><a href="${href}">${esc(r.name || '(untitled)')}</a>
            <span class="meta">step ${r.current_step ?? '-'} · ${esc(r.id)} · ${date}</span></li>`;
        })
        .join('')}
    </ul>`;

  const body = Array.from(groups.entries()).map(([email, items]) => section(email, items)).join('');

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Dev · all projects (${rows.length})</title>
  <style>
    body{font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:820px;margin:32px auto;padding:0 20px;color:#1a1a1a}
    h1{font-size:20px} h1 .badge{font-size:11px;background:#fde68a;color:#92400e;padding:2px 8px;border-radius:99px;vertical-align:middle;margin-left:8px}
    h2{font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#666;margin:28px 0 8px;border-bottom:1px solid #eee;padding-bottom:4px}
    h2 .n{background:#eee;color:#555;border-radius:99px;padding:1px 7px;font-size:11px;margin-left:6px}
    ul{list-style:none;padding:0;margin:0} li{padding:6px 0;border-bottom:1px solid #f4f4f4}
    a{color:#1d4ed8;text-decoration:none;font-weight:600} a:hover{text-decoration:underline}
    .meta{color:#999;font-size:11px;margin-left:8px} .note{color:#666;font-size:12px;margin-top:4px}
  </style></head><body>
  <h1>All projects <span class="badge">DEV · E2E bypass</span></h1>
  <p class="note">${rows.length} projects. Click any to log in as its owner and open it — no email, no data changes. This page is local-only (403 in production).</p>
  ${body}
  </body></html>`;

  return new NextResponse(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
