import { redirect } from 'next/navigation';

// Back-compat redirect — the Launch surface lives in the co-pilot's Build tab
// (Growth lane) since the 2026-07-14 merge. This stub keeps old links working.
export default async function LaunchRedirect({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  redirect(`/project/${projectId}/chat?tab=build`);
}
