import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

export interface AvatarGroupPerson {
  id: string;
  name: string;
  avatarUrl?: string | null;
}

const initialsOf = (n: string) =>
  n
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');

/** Overlapping avatars with a "+N" tail, as in the scheduler and board cards. */
export function AvatarGroup({
  people,
  max = 3,
  size = 'sm',
  className,
}: {
  people: AvatarGroupPerson[];
  max?: number;
  size?: 'sm' | 'default';
  className?: string;
}) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <div className={cn('flex items-center', className)}>
      <div className="flex -space-x-1.5">
        {shown.map((p) => (
          <Avatar key={p.id} size={size} className="ring-background ring-2" title={p.name}>
            {p.avatarUrl && <AvatarImage src={p.avatarUrl} alt="" />}
            <AvatarFallback className="bg-primary-soft text-primary text-xs font-semibold">
              {initialsOf(p.name)}
            </AvatarFallback>
          </Avatar>
        ))}
      </div>
      {extra > 0 && (
        <span className="text-muted-foreground tnum ml-1.5 text-xs font-medium">+{extra}</span>
      )}
    </div>
  );
}
