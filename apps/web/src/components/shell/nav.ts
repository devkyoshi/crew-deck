import {
  Building2,
  CreditCard,
  CalendarCheck,
  CalendarClock,
  Contact,
  Handshake,
  LayoutDashboard,
  UserPlus,
  ClipboardList,
  FileClock,
  Inbox,
  FolderKanban,
  Home,
  LayoutGrid,
  ListTodo,
  MessagesSquare,
  Settings,
  Users,
  UsersRound,
  UsersRound as TeamIcon,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  /** Phase of the build plan that delivers this screen (shown on the placeholder page). */
  phase?: number;
  /** Only shown to workspace admins. */
  adminOnly?: boolean;
  /** Hidden when check-in is switched off for the workspace. */
  needsCheckin?: boolean;
  /** Hidden when the CRM is off or the person has no CRM access. */
  needsCrm?: boolean;
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
      { title: 'Messages', href: '/messages', icon: MessagesSquare },
      { title: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
      { title: 'My work', href: '/my-work', icon: ListTodo },
      { title: 'My day', href: '/my-day', icon: CalendarCheck, needsCheckin: true },
      { title: 'Team', href: '/team', icon: TeamIcon, needsCheckin: true },
      { title: 'People', href: '/people', icon: Users },
      { title: 'Groups', href: '/groups', icon: UsersRound },
      {
        title: 'Attendance',
        href: '/admin/attendance',
        icon: ClipboardList,
        adminOnly: true,
        needsCheckin: true,
      },
    ],
  },
  {
    id: 'spaces',
    label: 'Spaces',
    items: [
      { title: 'All spaces', href: '/spaces', icon: LayoutGrid },
      { title: 'Access requests', href: '/access-requests', icon: Inbox },
    ],
  },
  {
    id: 'crm',
    label: 'CRM',
    items: [
      { title: 'Dashboard', href: '/crm', icon: LayoutDashboard, needsCrm: true },
      { title: 'Leads', href: '/crm/leads', icon: UserPlus, needsCrm: true },
      { title: 'Contacts', href: '/crm/contacts', icon: Contact, needsCrm: true },
      { title: 'Companies', href: '/crm/companies', icon: Building2, needsCrm: true },
      { title: 'Deals', href: '/crm/deals', icon: Handshake, needsCrm: true },
      { title: 'Activities', href: '/crm/activities', icon: CalendarClock, needsCrm: true },
      { title: 'Pipelines', href: '/crm/pipelines', icon: Workflow, needsCrm: true, adminOnly: true },
    ],
  },
  {
    id: 'admin',
    label: 'Administration',
    adminOnly: true,
    items: [
      { title: 'Members', href: '/admin/members', icon: Users },
      { title: 'Groups', href: '/admin/groups', icon: UsersRound },
      { title: 'Spaces', href: '/admin/spaces', icon: FolderKanban },
      { title: 'Plan and billing', href: '/admin/billing', icon: CreditCard },
      { title: 'Audit log', href: '/admin/audit', icon: FileClock },
      { title: 'Settings', href: '/admin/settings', icon: Settings },
    ],
  },
];

export const ALL_ITEMS = NAV.flatMap((g) => g.items.map((i) => ({ ...i, group: g })));

export function findNavItem(pathname: string) {
  return ALL_ITEMS.find((i) => i.href === pathname);
}

export function visibleGroups(isAdmin: boolean, checkinEnabled = true, crmVisible = true) {
  return NAV.filter((g) => !g.adminOnly || isAdmin)
    .map((g) => ({
      ...g,
      items: g.items.filter(
        (i) =>
          (!i.adminOnly || isAdmin) &&
          (!i.needsCheckin || checkinEnabled) &&
          (!i.needsCrm || crmVisible),
      ),
    }))
    .filter((g) => g.items.length > 0);
}

/** The rail's top-level modules. Each one owns a nav group that fills the contextual panel. */
export interface NavModule {
  id: 'home' | 'messages' | 'spaces' | 'crm' | 'admin';
  label: string;
  href: string;
  icon: LucideIcon;
  /** Which NAV group the panel shows while this module is active. */
  group: string;
}

export const MODULES: NavModule[] = [
  { id: 'home', label: 'Home', href: '/', icon: Home, group: 'workspace' },
  { id: 'messages', label: 'Messages', href: '/messages', icon: MessagesSquare, group: 'workspace' },
  { id: 'spaces', label: 'Spaces', href: '/spaces', icon: FolderKanban, group: 'spaces' },
  { id: 'crm', label: 'CRM', href: '/crm', icon: Handshake, group: 'crm' },
  { id: 'admin', label: 'Administration', href: '/admin/members', icon: Settings, group: 'admin' },
];

/** The module a path belongs to. Attendance is an admin-only page that lives in the workspace group. */
export function moduleForPath(pathname: string): NavModule['id'] {
  if (pathname.startsWith('/messages')) return 'messages';
  if (pathname.startsWith('/spaces') || pathname === '/access-requests' || pathname === '/request-access')
    return 'spaces';
  if (pathname.startsWith('/crm')) return 'crm';
  if (pathname.startsWith('/admin') && pathname !== '/admin/attendance') return 'admin';
  return 'home';
}
