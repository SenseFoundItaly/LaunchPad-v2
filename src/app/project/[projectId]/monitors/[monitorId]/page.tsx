import { redirect } from 'next/navigation';

// Back-compat — the standalone monitor detail page was folded into the
// Inbox's Watchers tab (MonitorListPanel rows expand in place). Old deep
// links land on /actions with the watcher pre-expanded via query params.
export default async function MonitorDetailRedirect({
  params,
}: {
  params: Promise<{ projectId: string; monitorId: string }>;
}) {
  const { projectId, monitorId } = await params;
  redirect(`/project/${projectId}/actions?lane=monitor&watcher=${monitorId}`);
}
