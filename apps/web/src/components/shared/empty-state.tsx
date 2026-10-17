import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Illustration, type IllustrationName } from '@/components/illustrations';
import { cn } from '@/lib/utils';

const BY_TITLE: [RegExp, IllustrationName][] = [
  [/caught up|nothing unread/i, 'caughtup'],
  [/offline|no connection/i, 'offline'],
  [/welcome|get started/i, 'welcome'],
  [/could not load|something went wrong/i, 'error'],
  [/admins only|admin only|don.t have access|switched off/i, 'lock'],
  [/not found/i, 'notfound'],
  [/not built yet/i, 'build'],
  [/match|nothing in this range/i, 'search'],
];

const BY_ICON: Record<string, IllustrationName> = {
  Users: 'people',
  UserX: 'people',
  UserPlus: 'people',
  LayoutGrid: 'spaces',
  FolderKanban: 'spaces',
  Inbox: 'inbox',
  MailPlus: 'inbox',
  CalendarClock: 'calendar',
  CalendarDays: 'calendar',
  ClockAlert: 'calendar',
  ClipboardList: 'calendar',
  Handshake: 'chart',
  Hammer: 'build',
  Lock: 'lock',
  ShieldAlert: 'lock',
  PowerOff: 'lock',
};

function pick(title: string, icon?: LucideIcon): IllustrationName {
  for (const [re, name] of BY_TITLE) if (re.test(title)) return name;
  const key = (icon as { displayName?: string } | undefined)?.displayName;
  return (key && BY_ICON[key]) || 'empty';
}

/**
 * Empty / error / gate state with a spot illustration (chosen from the title and icon unless
 * `illustration` is given). The dashed frame is dropped automatically inside cards and table cells.
 */
export function EmptyState({
  icon,
  illustration,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  illustration?: IllustrationName;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div
      className={cn(
        'animate-fade-up flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-10 text-center',
        'in-data-[slot=card]:rounded-none in-data-[slot=card]:border-0 in-data-[slot=card]:py-6',
        'in-[td]:rounded-none in-[td]:border-0 in-[td]:py-6',
      )}
    >
      <div className="animate-float">
        <Illustration name={illustration ?? pick(title, icon)} />
      </div>
      <div className="space-y-1">
        <h3 className="font-medium">{title}</h3>
        <p className="text-muted-foreground max-w-sm text-sm">{description}</p>
      </div>
      {action}
    </div>
  );
}
