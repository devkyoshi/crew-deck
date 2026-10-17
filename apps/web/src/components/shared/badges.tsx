import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const ROLE_STYLES: Record<string, string> = {
  owner: 'bg-violet-soft text-violet-soft-foreground ',
  admin: 'bg-info-soft text-info-soft-foreground ',
  member: 'bg-secondary text-secondary-foreground',
  viewer: 'bg-warning-soft text-warning-soft-foreground ',
};

export function RoleBadge({ role }: { role: string }) {
  return (
    <Badge
      variant="outline"
      className={cn('rounded-full border-transparent px-2.5 capitalize', ROLE_STYLES[role])}
    >
      {role}
    </Badge>
  );
}

const STATUS_STYLES: Record<string, { dot: string; label: string }> = {
  active: { dot: 'bg-success', label: 'Active' },
  invited: { dot: 'bg-warning', label: 'Invited' },
  deactivated: { dot: 'bg-muted-foreground/40', label: 'Deactivated' },
  onsite: { dot: 'bg-success', label: 'Onsite' },
  remote: { dot: 'bg-info', label: 'Remote' },
  offsite: { dot: 'bg-orange', label: 'Offsite' },
  leave: { dot: 'bg-muted-foreground/40', label: 'On leave' },
};

export function StatusChip({ status }: { status: keyof typeof STATUS_STYLES | string }) {
  const s = STATUS_STYLES[status] ?? { dot: 'bg-muted-foreground/40', label: status };
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className={cn('size-2 rounded-full', s.dot)} aria-hidden />
      {s.label}
    </span>
  );
}
