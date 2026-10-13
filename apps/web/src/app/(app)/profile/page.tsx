'use client';

import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ProfileForm, type ProfileValues } from '@/components/members/profile-form';
import { PageHeader } from '@/components/shared/page-header';
import { useMe } from '@/components/shell/me-context';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';

export default function ProfilePage() {
  const { user } = useMe();
  const router = useRouter();

  async function save(v: ProfileValues) {
    await api('/me', {
      method: 'PATCH',
      body: {
        name: v.name,
        jobTitle: v.jobTitle || null,
        timezone: v.timezone,
        avatarUrl: v.avatarUrl || null,
      },
    });
    toast.success('Profile updated');
    router.refresh();
  }

  return (
    <>
      <PageHeader title="Your profile" description="How you appear to your teammates." />
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Details</CardTitle>
          <CardDescription>{user.email}</CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm
            withAvatar
            initial={{
              name: user.name ?? '',
              jobTitle: user.jobTitle ?? '',
              timezone: user.timezone,
              avatarUrl: user.avatarUrl ?? '',
            }}
            onSubmit={save}
          />
        </CardContent>
      </Card>
    </>
  );
}
