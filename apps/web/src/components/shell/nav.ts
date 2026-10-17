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
  /** Heading it sits under in the panel. */
  section?: string;
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
      { title: 'Home', section: 'Main', href: '/', icon: Home },
      { title: 'Messages', section: 'Main', href: '/messages', icon: MessagesSquare },
      { title: 'Dashboard', section: 'Main', href: '/dashboard', icon: LayoutDashboard },
      { title: 'My work', section: 'Work', href: '/my-work', icon: ListTodo },
      { title: 'My day', section: 'Work', href: '/my-day', icon: CalendarCheck, needsCheckin: true },
      { title: 'Team', section: 'People', href: '/team', icon: TeamIcon, needsCheckin: true },
      { title: 'People', section: 'People', href: '/people', icon: Users },
      { title: 'Groups', section: 'People', href: '/groups', icon: UsersRound },
      {
        title: 'Attendance',
        section: 'Work',
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
      { title: 'Dashboard', section: 'Overview', href: '/crm', icon: LayoutDashboard, needsCrm: true },
      { title: 'Leads', section: 'Records', href: '/crm/leads', icon: UserPlus, needsCrm: true },
      { title: 'Contacts', section: 'Records', href: '/crm/contacts', icon: Contact, needsCrm: true },
      { title: 'Companies', section: 'Records', href: '/crm/companies', icon: Building2, needsCrm: true },
      { title: 'Deals', section: 'Records', href: '/crm/deals', icon: Handshake, needsCrm: true },
      { title: 'Activities', section: 'Manage', href: '/crm/activities', icon: CalendarClock, needsCrm: true },
      { title: 'Pipelines', section: 'Manage', href: '/crm/pipelines', icon: Workflow, needsCrm: true, adminOnly: true },
    ],
  },
  {
    id: 'admin',
    label: 'Administration',
    adminOnly: true,
    items: [
      { title: 'Members', section: 'People', href: '/admin/members', icon: Users },
      { title: 'Groups', section: 'People', href: '/admin/groups', icon: UsersRound },
      { title: 'Spaces', section: 'Workspace', href: '/admin/spaces', icon: FolderKanban },
      { title: 'Plan and billing', section: 'Billing and audit', href: '/admin/billing', icon: CreditCard },
      { title: 'Audit log', section: 'Billing and audit', href: '/admin/audit', icon: FileClock },
      { title: 'Settings', section: 'Workspace', href: '/admin/settings', icon: Settings },
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
