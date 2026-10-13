'use client';

import { Sparkles } from 'lucide-react';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { useMe } from '@/components/shell/me-context';

export default function HomePage() {
  const { user, org } = useMe();
  const first = user.name?.split(' ')[0] ?? 'there';
  return (
    <>
      <PageHeader title={`Welcome, ${first}`} description={`You are signed in to ${org.name}.`} />
      <EmptyState
        icon={Sparkles}
        title="Your workspace is ready"
        description="People, groups and spaces will appear here as they are added. For now, use the sidebar or press Ctrl+K to look around."
      />
    </>
  );
}
