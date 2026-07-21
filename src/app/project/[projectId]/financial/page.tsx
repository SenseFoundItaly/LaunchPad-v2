'use client';

import { use } from 'react';
import { useSetChrome } from '@/components/design/chrome-context';
import { useT } from '@/components/providers/LocaleProvider';
import FinancialModelPanel from '@/components/financial/FinancialModelPanel';

export default function FinancialPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const t = useT();
  useSetChrome(
    {
      breadcrumb: [t('fin.breadcrumb-project'), t('fin.breadcrumb-financials')],
      status: { heartbeatLabel: 'financials', gateway: 'projection-engine' },
    },
    [t],
  );
  return <FinancialModelPanel projectId={projectId} />;
}
