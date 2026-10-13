import { Hammer } from 'lucide-react';
import { notFound } from 'next/navigation';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { findNavItem } from '@/components/shell/nav';

/** Placeholder for navigation targets whose screens are built in later phases. */
export default async function ComingSoon({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const item = findNavItem('/' + slug.join('/'));
  if (!item) notFound();
  return (
    <>
      <PageHeader title={item.title} />
      <EmptyState
        icon={Hammer}
        title="Not built yet"
        description={`This screen arrives in Phase ${item.phase}.`}
      />
    </>
  );
}
