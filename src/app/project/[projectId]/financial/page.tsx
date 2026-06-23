'use client';

import { use } from 'react';
import { useSetChrome } from '@/components/design/chrome-context';
import FinancialModelPanel from '@/components/financial/FinancialModelPanel';

export default function FinancialPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  useSetChrome(
    {
      breadcrumb: ['Project', 'Financials'],
      status: { heartbeatLabel: 'financials', gateway: 'projection-engine' },
    },
    [],
  );
  return <FinancialModelPanel projectId={projectId} />;
}
