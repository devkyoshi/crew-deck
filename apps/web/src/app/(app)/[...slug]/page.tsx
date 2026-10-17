import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Illustration } from '@/components/illustrations';
import { PageHeader } from '@/components/shared/page-header';
import { findNavItem } from '@/components/shell/nav';
import { Button } from '@/components/ui/button';

/** Placeholder for navigation targets whose screens are built in later phases. */
export default async function ComingSoon({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const item = findNavItem('/' + slug.join('/'));
  if (!item) notFound();
  return (
    <>
      <PageHeader title={item.title} />
      <div className="animate-fade-up mx-auto flex max-w-md flex-col items-center gap-3 py-12 text-center">
        <div className="animate-float">
          <Illustration name="build" size="lg" />
        </div>
        <h2 className="font-medium">Coming soon</h2>
        <p className="text-muted-foreground text-sm">
          We are still building {item.title}. It arrives in Phase {item.phase}.
        </p>
        <Button variant="outline" asChild>
          <Link href="/">Back to home</Link>
        </Button>
      </div>
    </>
  );
}
