'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { WorkStatus } from '@/lib/work';
import { CreateItemDialog } from './create-item-dialog';

/**
 * "New ticket" for a service desk. Anyone who can see the desk may raise one, so unlike "Create" on a
 * board it does not depend on member rights.
 */
export function NewTicketButton({
  spaceKey,
  statuses,
}: {
  spaceKey: string;
  statuses: Pick<WorkStatus, 'id' | 'name' | 'category' | 'color'>[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} disabled={statuses.length === 0} data-testid="new-ticket">
        <Plus /> New ticket
      </Button>
      <CreateItemDialog
        spaceKey={spaceKey}
        statuses={statuses}
        open={open}
        onOpenChange={setOpen}
        defaults={{ type: 'ticket' }}
      />
    </>
  );
}
