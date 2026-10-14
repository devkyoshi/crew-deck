'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Globe, ShieldCheck, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { FormRow, FormSection } from '@/components/ui/form-layout';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Illustration } from '@/components/illustrations';
import { Notice } from '@/components/shared/notice';
import { useFormFeedback } from '@/hooks/use-form-feedback';
import { Skeleton } from '@/components/ui/skeleton';
import { api, ApiError, type Providers } from '@/lib/api';

const MIN_PASSWORD = 10;

const schema = z
  .object({
    name: z.string().trim().min(1, 'Enter your name').max(100),
    password: z.string().min(MIN_PASSWORD, `Use at least ${MIN_PASSWORD} characters`),
    confirm: z.string(),
    timezone: z.string().min(1),
    avatarUrl: z.string().trim().url('Enter a valid URL').or(z.literal('')),
  })
  .refine((v) => v.password === v.confirm, {
    path: ['confirm'],
    message: 'Passwords do not match',
  });
type Values = z.infer<typeof schema>;

type Preview = { email: string; orgName: string; orgSlug: string };

export function AcceptInviteForm({ token }: { token: string }) {
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [invalid, setInvalid] = useState(!token);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      avatarUrl: '',
    },
  });

  const { shakeKey, onInvalid } = useFormFeedback();

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const p = await api<Preview>('/auth/invite/preview', { body: { token } });
        // An invite belongs to one workspace: continue on that workspace's address.
        const providers = await api<Providers>('/auth/providers');
        if (providers.tenant?.slug !== p.orgSlug) {
          const { protocol, host } = window.location;
          const rest = providers.tenant ? host.split('.').slice(1).join('.') : host;
          window.location.replace(
            `${protocol}//${p.orgSlug}.${rest}/accept-invite?token=${encodeURIComponent(token)}`,
          );
          return;
        }
        setPreview(p);
      } catch {
        setInvalid(true);
      }
    })();
  }, [token]);

  async function onSubmit(v: Values) {
    setFormError(null);
    try {
      await api('/auth/invite/accept', {
        body: {
          token,
          name: v.name,
          password: v.password,
          timezone: v.timezone,
          ...(v.avatarUrl ? { avatarUrl: v.avatarUrl } : {}),
        },
      });
      router.replace('/');
      router.refresh();
    } catch (e) {
      const err = e as ApiError;
      if (err.code === 'invalid_invitation') setInvalid(true);
      else if (err.code === 'domain_not_allowed')
        setFormError('Your email is not on this workspace’s domain.');
      else setFormError(err.message);
    }
  }

  if (invalid) {
    return (
      <Card>
        <CardHeader className="items-center text-center">
          <Illustration name="lock" />
          <CardTitle className="text-xl">Invitation not valid</CardTitle>
          <CardDescription>
            This link is invalid, already used, or has expired. Ask a workspace admin to send a new
            invitation.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" className="w-full" onClick={() => router.push('/sign-in')}>
            Go to sign in
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!preview) {
    return (
      <Card>
        <CardContent className="space-y-3" aria-busy="true" aria-label="Loading invitation">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="items-center text-center">
        <CardTitle className="text-xl">Join {preview.orgName}</CardTitle>
        <CardDescription>
          Set up your account for{' '}
          <span className="text-foreground font-medium">{preview.email}</span>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="space-y-5" noValidate>
          {formError && <Notice variant="error">{formError}</Notice>}

          <FormSection title="Your profile" icon={UserRound}>
            <Field
              label="Full name"
              htmlFor="name"
              error={errors.name?.message}
              shakeKey={shakeKey}
            >
              <Input autoComplete="name" {...register('name')} />
            </Field>
            <Field
              label="Avatar URL (optional)"
              htmlFor="avatarUrl"
              error={errors.avatarUrl?.message}
              shakeKey={shakeKey}
            >
              <Input placeholder="https://…" {...register('avatarUrl')} />
            </Field>
          </FormSection>

          <FormSection title="Security" icon={ShieldCheck}>
            <FormRow>
              <Field
                label="Password"
                htmlFor="password"
                error={errors.password?.message}
                hint={`At least ${MIN_PASSWORD} characters.`}
                shakeKey={shakeKey}
              >
                <PasswordInput autoComplete="new-password" {...register('password')} />
              </Field>
              <Field
                label="Confirm password"
                htmlFor="confirm"
                error={errors.confirm?.message}
                shakeKey={shakeKey}
              >
                <PasswordInput autoComplete="new-password" {...register('confirm')} />
              </Field>
            </FormRow>
          </FormSection>

          <FormSection title="Preferences" icon={Globe}>
            <Field
              label="Timezone"
              htmlFor="timezone"
              error={errors.timezone?.message}
              hint="Used to work out your day."
              shakeKey={shakeKey}
            >
              <Input {...register('timezone')} />
            </Field>
          </FormSection>

          <Button type="submit" className="w-full" loading={isSubmitting}>
            {isSubmitting ? 'Creating account…' : 'Create account'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
