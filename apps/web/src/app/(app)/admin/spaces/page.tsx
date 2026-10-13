'use client';

import Link from 'next/link';
import { Plus, ShieldAlert } from 'lucide-react';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { useIsAdmin } from '@/components/shell/me-context';
import { SpacesDirectory } from '@/components/spaces/spaces-directory';
import { Button } from '@/components/ui/button';

/** Admins see every space, including private and archived ones the API hides from other people. */
export default function AdminSpacesPage() {
  const isAdmin = useIsAdmin();
  if (!isAdmin) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Admins only"
        description="You need to be a workspace admin to manage all spaces."
      />
    );
  }
  return (
    <>
      <PageHeader
        title="All spaces"
        description="Every space in the workspace, including private and archived ones."
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
