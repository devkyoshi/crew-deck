import { Badge } from '@/components/ui/badge';
import { LEAD_STATUS_LABEL, type DealStatus, type LeadStatus } from '@/lib/crm';
import { cn } from '@/lib/utils';

const LEAD_TONE: Record<LeadStatus, string> = {
  new: 'bg-info-soft text-info-soft-foreground ',
  contacted: 'bg-warning-soft text-warning-soft-foreground ',
  qualified: 'bg-success-soft text-success-soft-foreground ',
  unqualified: 'bg-secondary text-secondary-foreground',
};

const pill = 'rounded-full border-transparent px-2.5 font-normal';

export function LeadStatusPill({
  lead,
}: {
  lead: { status: LeadStatus; convertedAt: string | null };
}) {
  if (lead.convertedAt) {
    return (
      <Badge
        variant="outline"
        className={cn(
          pill,
          'bg-violet-soft text-violet-soft-foreground ',
        )}
      >
        Converted
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className={cn(pill, LEAD_TONE[lead.status])}>
      {LEAD_STATUS_LABEL[lead.status]}
    </Badge>
  );
}

const DEAL_TONE: Record<DealStatus, string> = {
  open: 'bg-info-soft text-info-soft-foreground ',
  won: 'bg-success-soft text-success-soft-foreground ',
  lost: 'bg-danger-soft text-danger-soft-foreground ',
};

export function DealStatusPill({ status }: { status: DealStatus }) {
  return (
    <Badge variant="outline" className={cn(pill, 'capitalize', DEAL_TONE[status])}>
      {status}
    </Badge>
  );
}
