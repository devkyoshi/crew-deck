import { Badge } from '@/components/ui/badge';
import { LEAD_STATUS_LABEL, type DealStatus, type LeadStatus } from '@/lib/crm';
import { cn } from '@/lib/utils';

const LEAD_TONE: Record<LeadStatus, string> = {
  new: 'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300',
  contacted: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
  qualified: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300',
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
          'bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300',
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
  open: 'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300',
  won: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300',
  lost: 'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300',
};

export function DealStatusPill({ status }: { status: DealStatus }) {
  return (
    <Badge variant="outline" className={cn(pill, 'capitalize', DEAL_TONE[status])}>
      {status}
    </Badge>
  );
}
