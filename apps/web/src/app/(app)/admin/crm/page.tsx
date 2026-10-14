'use client';

import { ShieldAlert } from 'lucide-react';
import { CrmSettings } from '@/components/crm/pipeline-settings';
import { EmptyState } from '@/components/shared/empty-state';
import { useIsAdmin } from '@/components/shell/me-context';

export default function Page() {
  const isAdmin = useIsAdmin();
  if (!isAdmin) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Admins only"
        description="You need to be a workspace admin to change CRM settings."
      />
    );
  }
  return <CrmSettings />;
}
