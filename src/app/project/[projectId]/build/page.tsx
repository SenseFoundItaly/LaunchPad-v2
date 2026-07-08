'use client';

import { use } from 'react';
import { useSetChrome } from '@/components/design/chrome-context';
import BuildHub from '@/components/build/BuildHub';

export default function BuildPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  useSetChrome({ breadcrumb: ['Project', 'Build'] }, []);
  return <BuildHub projectId={projectId} />;
}
