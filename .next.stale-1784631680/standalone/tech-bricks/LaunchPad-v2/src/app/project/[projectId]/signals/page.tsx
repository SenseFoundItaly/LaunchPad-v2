import { redirect } from 'next/navigation';

// Back-compat redirect — /signals was retired in the Phase 1 consolidation
// (2026-06). signal_alert + intelligence_brief items now live in /actions
// (Inbox). This stub keeps old bookmarks and external links working.
export default async function SignalsRedirect({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  redirect(`/project/${projectId}/actions`);
}
