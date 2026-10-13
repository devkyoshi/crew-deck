import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const ROLE_STYLES: Record<string, string> = {
  owner: 'bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300',
  admin: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300',
  member: 'bg-secondary text-secondary-foreground',
  viewer: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
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
  active: { dot: 'bg-emerald-500', label: 'Active' },
  invited: { dot: 'bg-amber-500', label: 'Invited' },
  deactivated: { dot: 'bg-zinc-400', label: 'Deactivated' },
  onsite: { dot: 'bg-emerald-500', label: 'Onsite' },
  remote: { dot: 'bg-sky-500', label: 'Remote' },
  offsite: { dot: 'bg-orange-500', label: 'Offsite' },
  leave: { dot: 'bg-zinc-400', label: 'On leave' },
};

export function StatusChip({ status }: { status: keyof typeof STATUS_STYLES | string }) {
  const s = STATUS_STYLES[status] ?? { dot: 'bg-zinc-400', label: status };
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className={cn('size-2 rounded-full', s.dot)} aria-hidden />
      {s.label}
    </span>
  );
}
