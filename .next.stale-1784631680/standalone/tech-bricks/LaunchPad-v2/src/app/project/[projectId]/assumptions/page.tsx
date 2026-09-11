import { redirect } from 'next/navigation';

// Back-compat redirect — /assumptions was retired in the Phase 1
// consolidation (2026-06). Open assumptions now materialize as
// assumption_review items in /actions (Inbox). Keeps old bookmarks working.
export default async function AssumptionsRedirect({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  redirect(`/project/${projectId}/actions`);
}
