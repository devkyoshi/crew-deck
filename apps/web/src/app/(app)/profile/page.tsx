'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bell, Moon, Palette, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { toast } from '@/lib/toast';
import { ProfileForm, type ProfileValues } from '@/components/members/profile-form';
import { SecurityPanel } from '@/components/members/security-panel';
import { PageContainer } from '@/components/shared/page-container';
import { PageHeader } from '@/components/shared/page-header';
import { TabPanel } from '@/components/shared/motion';
import { ImageUpload } from '@/components/shared/image-upload';
import { RoleBadge } from '@/components/shared/badges';
import { initials, useMe } from '@/components/shell/me-context';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

type Tab = 'profile' | 'security' | 'preferences';
const TABS: Tab[] = ['profile', 'security', 'preferences'];

function Preferences() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const options = [
    { id: 'light', label: 'Light', icon: Sun },
    { id: 'dark', label: 'Dark', icon: Moon },
    { id: 'system', label: 'Match my device', icon: Palette },
  ];
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>How Crew Deck looks on this device.</CardDescription>
        </CardHeader>
        <CardContent>
          <div role="radiogroup" aria-label="Theme" className="grid max-w-lg gap-2 sm:grid-cols-3">
            {options.map((o) => (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={mounted && theme === o.id}
                onClick={() => setTheme(o.id)}
                className={cn(
                  'hover:bg-accent/60 flex items-center gap-2 rounded-lg border p-3 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  mounted && theme === o.id && 'border-foreground ring-foreground ring-1',
                )}
              >
                <o.icon className="size-4" strokeWidth={1.5} aria-hidden />
                {o.label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="size-4" strokeWidth={1.5} aria-hidden /> Notifications
          </CardTitle>
          <CardDescription>
            Quiet hours, email delay and what reaches you are set in Messages and Notifications.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-4 text-sm">
          <Link href="/notifications" className="text-primary underline-offset-4 hover:underline">
            Open notifications
          </Link>
          <Link href="/messages/activity" className="text-primary underline-offset-4 hover:underline">
            Mentions and reactions
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

export default function ProfilePage() {
  const { user, org, orgRole } = useMe();
  const router = useRouter();
  const forced = user.mustChangePassword === true;
  const [tab, setTab] = useState<Tab>(forced ? 'security' : 'profile');

  // /profile?tab=security opens that tab.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t && (TABS as string[]).includes(t)) setTab(t as Tab);
  }, []);

  async function save(v: ProfileValues) {
    await api('/me', {
      method: 'PATCH',
      body: {
        name: v.name,
        jobTitle: v.jobTitle || null,
        timezone: v.timezone,
      },
    });
    toast.success('Profile updated');
    router.refresh();
  }

  return (
    <PageContainer>
      <PageHeader title="Your profile" description="Your details, password and preferences." />
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="gap-6">
        <TabsList variant="line" aria-label="Profile sections">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="preferences">Preferences</TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <TabPanel id="profile" className="grid items-start gap-6 md:grid-cols-[18rem_minmax(0,1fr)]">
            <Card className="gap-5 p-6">
              <ImageUpload
                endpoint="/me/avatar"
                removeEndpoint="/me/avatar"
                preview={user.avatarUrl}
                label="Profile photo"
                fallback={initials(user.name, user.email)}
                onChanged={() => router.refresh()}
              />
              <div className="space-y-1 border-t pt-4">
                <p className="text-heading truncate">{user.name ?? user.email}</p>
                <p className="text-muted-foreground truncate text-sm">{user.email}</p>
                {user.jobTitle && (
                  <p className="text-muted-foreground truncate text-sm">{user.jobTitle}</p>
                )}
                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <RoleBadge role={orgRole} />
                  <span className="text-muted-foreground truncate text-xs">{org.name}</span>
                </div>
              </div>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Details</CardTitle>
                <CardDescription>
                  This is what people see on your profile card and in chat. Your status is in the
                  profile menu at the top right.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ProfileForm
                  initial={{
                    name: user.name ?? '',
                    jobTitle: user.jobTitle ?? '',
                    timezone: user.timezone,
                  }}
                  onSubmit={save}
                />
              </CardContent>
            </Card>
          </TabPanel>
        </TabsContent>

        <TabsContent value="security">
          <TabPanel id="security" className="max-w-2xl">
            <SecurityPanel forced={forced} />
          </TabPanel>
        </TabsContent>

        <TabsContent value="preferences">
          <TabPanel id="preferences" className="max-w-2xl">
            <Preferences />
          </TabPanel>
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
