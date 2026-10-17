'use client';

import { use, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSpace } from '@/components/spaces/space-context';
import { ItemDetail } from '@/components/work/item-detail';
import { useItem } from '@/lib/work-api';

/** The shareable full-page view of one work item, e.g. /spaces/ENG/items/ENG-142. */
export default function ItemPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = use(params);
  const space = useSpace();
  const router = useRouter();
  const itemRef = decodeURIComponent(ref);
  const found = useItem(itemRef).data;
  // An old key of a moved item resolves to it; show the address it lives at now.
  useEffect(() => {
    if (found && itemRef.toUpperCase() !== found.key) {
      router.replace(`/spaces/${found.key.split('-')[0]}/items/${found.key}`);
    }
  }, [found, itemRef, router]);
  return (
    <div className="space-y-3">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href={`/spaces/${space.key}/board`}>
          <ArrowLeft /> Board
        </Link>
      </Button>
      <div className="bg-card rounded-lg border p-6">
        <ItemDetail
          itemRef={itemRef}
          variant="page"
          onOpenItem={(key) => router.push(`/spaces/${key.split('-')[0]}/items/${key}`)}
        />
      </div>
    </div>
  );
}
