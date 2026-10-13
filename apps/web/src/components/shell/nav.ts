import {
  FileClock,
  FolderKanban,
  Home,
  LayoutGrid,
  Settings,
  Users,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  /** Phase of the build plan that delivers this screen (shown on the placeholder page). */
  phase?: number;
}

export interface NavGroup {
  id: string;
  label: string;
  adminOnly?: boolean;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    id: 'workspace',
    label: 'Workspace',
    items: [
      { title: 'Home', href: '/', icon: Home },
      { title: 'People', href: '/people', icon: Users, phase: 2 },
      { title: 'Groups', href: '/groups', icon: UsersRound, phase: 3 },
    ],
  },
  {
    id: 'spaces',
    label: 'Spaces',
    items: [{ title: 'All spaces', href: '/spaces', icon: LayoutGrid, phase: 4 }],
  },
  {
    id: 'admin',
    label: 'Administration',
    adminOnly: true,
    items: [
      { title: 'Members', href: '/admin/members', icon: Users, phase: 2 },
      { title: 'Groups', href: '/admin/groups', icon: UsersRound, phase: 3 },
      { title: 'Spaces', href: '/admin/spaces', icon: FolderKanban, phase: 4 },
      { title: 'Audit log', href: '/admin/audit', icon: FileClock, phase: 5 },
      { title: 'Settings', href: '/admin/settings', icon: Settings, phase: 9 },
    ],
  },
];

export const ALL_ITEMS = NAV.flatMap((g) => g.items.map((i) => ({ ...i, group: g })));

export function findNavItem(pathname: string) {
  return ALL_ITEMS.find((i) => i.href === pathname);
}

export function visibleGroups(isAdmin: boolean) {
  return NAV.filter((g) => !g.adminOnly || isAdmin);
}
