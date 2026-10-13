'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { SpacesDirectory } from '@/components/spaces/spaces-directory';
import { Button } from '@/components/ui/button';

export default function SpacesPage() {
  return (
    <>
      <PageHeader
        title="Spaces"
        description="Projects and teams you can work in."
        action={
          <Button asChild>
            <Link href="/spaces/new">
              <Plus /> Create space
            </Link>
          </Button>
        }
      />
      <SpacesDirectory />
    </>
  );
}
