'use client';

import KnowledgeReviewList from './KnowledgeReviewList';

interface PendingKnowledgeListProps {
  projectId: string;
  locale: 'en' | 'it';
}

export default function PendingKnowledgeList({ projectId, locale }: PendingKnowledgeListProps) {
  return <KnowledgeReviewList projectId={projectId} locale={locale} />;
}
