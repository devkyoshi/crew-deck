'use client';

import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ProfileForm, type ProfileValues } from '@/components/members/profile-form';
import { PageHeader } from '@/components/shared/page-header';
import { ImageUpload } from '@/components/shared/image-upload';
import { RoleBadge } from '@/components/shared/badges';
import { initials, useMe } from '@/components/shell/me-context';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';

export default function ProfilePage() {
  const { user, org, orgRole } = useMe();
  const router = useRouter();

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
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Your profile" description="How you appear to your teammates." />
      <div className="grid items-start gap-6 md:grid-cols-[18rem_minmax(0,1fr)]">
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
            {user.jobTitle && <p className="text-muted-foreground truncate text-sm">{user.jobTitle}</p>}
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <RoleBadge role={orgRole} />
              <span className="text-muted-foreground truncate text-xs">{org.name}</span>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
            <CardDescription>This is what people see on your profile card and in chat.</CardDescription>
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
      </div>
    </div>
  );
}
