'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { CreateSpaceWizard } from '@/components/spaces/create-space-wizard';
import { Button } from '@/components/ui/button';

export default function NewSpacePage() {
  return (
    <>
      <Button variant="ghost" size="sm" asChild className="-ml-2 mb-2">
        <Link href="/spaces">
          <ArrowLeft /> Spaces
        </Link>
      </Button>
      <PageHeader title="Create space" description="Set up a new space in a few quick steps." />
      <CreateSpaceWizard />
    </>
  );
}
