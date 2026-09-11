import { redirect } from 'next/navigation';

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  // Landing → /today (Home in NavRail). Phase 1 consolidation removed the
  // dedicated /signals surface; founders now triage proposals in /actions
  // (Inbox), but Home is the natural first stop after sign-in.
  redirect(`/project/${projectId}/today`);
}
