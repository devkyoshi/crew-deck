import { redirect } from 'next/navigation';
import { AppShell } from '@/components/shell/app-shell';
import { getMe } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  if (!me) redirect('/sign-in');
  return <AppShell me={me}>{children}</AppShell>;
}
