'use client';

import { Plus, ShieldAlert } from 'lucide-react';
import { GroupFormDialog } from '@/components/groups/group-form-dialog';
import { GroupsList } from '@/components/groups/groups-list';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { useIsAdmin } from '@/components/shell/me-context';
import { Button } from '@/components/ui/button';

export default function AdminGroupsPage() {
  const isAdmin = useIsAdmin();
  if (!isAdmin) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Admins only"
        description="You need to be a workspace admin to manage groups."
      />
    );
  }
  return (
    <>
      <PageHeader
        title="Groups"
        description="Create teams, rename them and manage who belongs."
        action={
          <GroupFormDialog
            trigger={
              <Button>
                <Plus /> New group
              </Button>
            }
          />
        }
      />
      <GroupsList admin />
    </>
  );
}
