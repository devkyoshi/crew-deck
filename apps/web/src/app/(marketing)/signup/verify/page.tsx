'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Skeleton } from '@/components/ui/skeleton';
import { Notice } from '@/components/shared/notice';
import { useFormFeedback } from '@/hooks/use-form-feedback';
import { api, ApiError } from '@/lib/api';

function VerifyInner() {
  const token = useSearchParams().get('token') ?? '';
  const preview = useQuery({
    queryKey: ['signup-preview', token],
    queryFn: () =>
      api<{ email: string; company: string; slug: string; hasAccount: boolean }>(
        '/signup/preview',
        {
          body: { token },
        },
      ),
    enabled: token.length > 0,
    retry: false,
  });
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { shakeKey, fail } = useFormFeedback();

  if (!token || preview.isError) {
    return (
      <Card className="mx-auto mt-10 max-w-md">
        <CardHeader className="items-center text-center">
          <CardTitle className="text-xl">This link has expired</CardTitle>
          <CardDescription>
            The sign-up link is invalid, already used, or older than 24 hours.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          <Button asChild>
            <Link href="/signup">Start again</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }
  if (preview.isPending) {
    return (
      <Skeleton
        role="status"
        aria-label="Loading"
        className="mx-auto mt-10 h-72 max-w-md rounded-2xl"
      />
    );
  }
  const p = preview.data;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'Enter your name';
    if (!p.hasAccount && password.length < 10) next.password = 'Use at least 10 characters';
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length) return fail();
    setBusy(true);
    try {
      const res = await api<{ url: string }>('/signup/verify', {
        body: {
          token,
          name: name.trim(),
          ...(p.hasAccount ? {} : { password }),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      });
      // The new workspace has its own address; this hands the signed-in session to it.
      window.location.assign(res.url);
    } catch (err) {
      if (err instanceof ApiError && err.fields && Object.keys(err.fields).length) {
        setErrors(err.fields);
      } else {
        setFormError(
          err instanceof ApiError ? err.message : 'Something went wrong. Please try again.',
        );
      }
      fail();
      setBusy(false);
    }
  }

  return (
    <Card className="mx-auto mt-10 max-w-md">
      <CardHeader className="items-center text-center">
        <CardTitle className="text-xl">Create {p.company}</CardTitle>
        <CardDescription>
          You are creating <strong className="text-foreground">{p.slug}</strong> as{' '}
          <strong className="text-foreground">{p.email}</strong>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4" noValidate>
          {formError && <Notice variant="error">{formError}</Notice>}
          <Field label="Your name" htmlFor="name" error={errors.name} shakeKey={shakeKey}>
            <Input
              autoComplete="name"
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          {p.hasAccount ? (
            <Notice variant="info">
              You already have a Crew Deck account, so you will keep your existing password.
            </Notice>
          ) : (
            <Field
              label="Choose a password"
              htmlFor="password"
              error={errors.password}
              hint="At least 10 characters."
              shakeKey={shakeKey}
            >
              <PasswordInput
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
          )}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? 'Creating…' : 'Create my workspace'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export default function VerifyPage() {
  return (
    <Suspense
      fallback={
        <Skeleton
          role="status"
          aria-label="Loading"
          className="mx-auto mt-10 h-72 max-w-md rounded-2xl"
        />
      }
    >
      <VerifyInner />
    </Suspense>
  );
}
