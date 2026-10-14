'use client';

import { use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSpace } from '@/components/spaces/space-context';
import { ItemDetail } from '@/components/work/item-detail';

/** The shareable full-page view of one work item, e.g. /spaces/ENG/items/ENG-142. */
export default function ItemPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = use(params);
  const space = useSpace();
  const router = useRouter();
  return (
    <div className="space-y-3">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href={`/spaces/${space.key}/board`}>
          <ArrowLeft /> Board
        </Link>
      </Button>
      <div className="bg-card rounded-2xl border p-6">
        <ItemDetail
          itemRef={decodeURIComponent(ref)}
          variant="page"
          onOpenItem={(key) => router.push(`/spaces/${space.key}/items/${key}`)}
        />
      </div>
    </div>
  );
}
