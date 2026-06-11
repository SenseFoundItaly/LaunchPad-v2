import { redirect } from 'next/navigation';

// Back-compat index — /monitors only ever shipped the [monitorId] detail
// page, so the bare index 404'd. Watchers are reviewed in /actions (Inbox),
// same consolidation target as the /signals and /assumptions stubs.
export default async function MonitorsRedirect({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  redirect(`/project/${projectId}/actions`);
}
