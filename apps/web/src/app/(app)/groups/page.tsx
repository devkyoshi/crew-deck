'use client';

import { Plus } from 'lucide-react';
import { GroupFormDialog } from '@/components/groups/group-form-dialog';
import { GroupsList } from '@/components/groups/groups-list';
import { PageHeader } from '@/components/shared/page-header';
import { useIsAdmin } from '@/components/shell/me-context';
import { Button } from '@/components/ui/button';

export default function GroupsPage() {
  const isAdmin = useIsAdmin();
  return (
    <>
      <PageHeader
        title="Groups"
        description="Teams across your workspace."
        action={
          isAdmin ? (
            <GroupFormDialog
              trigger={
                <Button>
                  <Plus /> New group
                </Button>
              }
            />
          ) : undefined
        }
      />
      <GroupsList admin={isAdmin} />
    </>
  );
}
