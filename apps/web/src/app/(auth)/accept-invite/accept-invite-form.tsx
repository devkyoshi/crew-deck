'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-destructive text-xs">
          {error}
        </p>
      ) : (
        hint && <p className="text-muted-foreground text-xs">{hint}</p>
      )}
    </div>
  );
}

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
        <CardHeader className="text-center">
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
      <CardHeader className="text-center">
        <CardTitle className="text-xl">Join {preview.orgName}</CardTitle>
        <CardDescription>
          Set up your account for{' '}
          <span className="text-foreground font-medium">{preview.email}</span>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          {formError && (
            <div
              role="alert"
              className="border-destructive/30 bg-destructive/5 text-destructive flex items-start gap-2 rounded-md border p-3 text-sm"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {formError}
            </div>
          )}
          <Field id="name" label="Full name" error={errors.name?.message}>
            <Input
              id="name"
              autoComplete="name"
              aria-invalid={!!errors.name}
              {...register('name')}
            />
          </Field>
          <Field
            id="password"
            label="Password"
            error={errors.password?.message}
            hint={`At least ${MIN_PASSWORD} characters.`}
          >
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              aria-invalid={!!errors.password}
              {...register('password')}
            />
          </Field>
          <Field id="confirm" label="Confirm password" error={errors.confirm?.message}>
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              aria-invalid={!!errors.confirm}
              {...register('confirm')}
            />
          </Field>
          <Field
            id="timezone"
            label="Timezone"
            error={errors.timezone?.message}
            hint="Used to work out your day."
          >
            <Input id="timezone" {...register('timezone')} />
          </Field>
          <Field id="avatarUrl" label="Avatar URL (optional)" error={errors.avatarUrl?.message}>
            <Input
              id="avatarUrl"
              placeholder="https://…"
              aria-invalid={!!errors.avatarUrl}
              {...register('avatarUrl')}
            />
          </Field>
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Creating account…' : 'Create account'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
