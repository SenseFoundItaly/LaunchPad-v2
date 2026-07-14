import { redirect } from 'next/navigation';

// Back-compat redirect — Build & Launch merged into the co-pilot as a tab
// (founder directive 2026-07-14). This stub keeps old bookmarks working.
export default async function BuildRedirect({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  redirect(`/project/${projectId}/chat?tab=build`);
}
