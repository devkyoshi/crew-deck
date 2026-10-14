'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2, PartyPopper } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Skeleton } from '@/components/ui/skeleton';
import { Notice } from '@/components/shared/notice';
import { MIN_PASSWORD, PasswordStrength } from '@/components/auth/password-strength';
import { useWizard, WizardProgress } from '@/components/auth/wizard';
import { useFormFeedback } from '@/hooks/use-form-feedback';
import { api, ApiError } from '@/lib/api';

const STEPS = ['you', 'password', 'done'] as const;
const LABELS = [
  { id: 'you', label: 'You' },
  { id: 'password', label: 'Password' },
  { id: 'done', label: 'Ready' },
];

interface Answers {
  name: string;
  password: string;
  url: string | null;
}
const INITIAL: Answers = { name: '', password: '', url: null };

interface Preview {
  email: string;
  company: string;
  slug: string;
  hasAccount: boolean;
  name: string | null;
}

function Heading({
  headingRef,
  children,
  lead,
}: {
  headingRef: React.Ref<HTMLHeadingElement>;
  children: React.ReactNode;
  lead?: React.ReactNode;
}) {
  return (
    <div className="mb-6 space-y-2">
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="text-2xl font-semibold tracking-tight outline-none sm:text-3xl"
      >
        {children}
      </h1>
      {lead && <p className="text-muted-foreground">{lead}</p>}
    </div>
  );
}

function Expired() {
  return (
    <Card className="shadow-lg">
      <CardContent className="space-y-4 p-6 sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight">This link has expired</h1>
        <p className="text-muted-foreground">
          Sign-up links work once and last 24 hours. If you already used it, your workspace exists:
          find it and sign in. Otherwise start again and we will send a fresh one.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/signup">Start again</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/workspaces">Find my workspace</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function VerifyWizard({ token, preview }: { token: string; preview: Preview }) {
  const w = useWizard<Answers>({ steps: STEPS, initial: { ...INITIAL, name: preview.name ?? '' } });
  const { shakeKey, fail } = useFormFeedback();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const a = w.data;

  async function create() {
    setBusy(true);
    setFormError(null);
    try {
      const res = await api<{ url: string }>('/signup/verify', {
        body: {
          token,
          name: a.name.trim(),
          ...(preview.hasAccount ? {} : { password: a.password }),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      });
      w.jumpTo('done', { url: res.url, password: '' });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'invalid_signup_link') {
        window.location.reload();
        return;
      }
      if (err instanceof ApiError && err.fields && Object.keys(err.fields).length)
        setErrors(err.fields);
      else
        setFormError(
          err instanceof ApiError ? err.message : 'Something went wrong. Please try again.',
        );
      fail();
      setBusy(false);
    }
  }

  // On the last step the workspace is ready: carry on to it after a moment.
  useEffect(() => {
    if (w.step !== 'done' || !a.url) return;
    const t = setTimeout(() => window.location.assign(a.url!), 2500);
    return () => clearTimeout(t);
  }, [w.step, a.url]);

  if (!w.ready)
    return <Skeleton role="status" aria-label="Loading" className="h-96 w-full rounded-2xl" />;

  function fromYou(e: React.FormEvent) {
    e.preventDefault();
    if (!a.name.trim()) {
      setErrors({ name: 'Tell us what to call you' });
      return fail();
    }
    setErrors({});
    if (preview.hasAccount) void create();
    else w.next({ name: a.name.trim() });
  }

  function fromPassword(e: React.FormEvent) {
    e.preventDefault();
    if (a.password.length < MIN_PASSWORD) {
      setErrors({ password: `Use at least ${MIN_PASSWORD} characters` });
      return fail();
    }
    setErrors({});
    void create();
  }

  const first = (a.name || preview.name || '').trim().split(/\s+/)[0];
  const steps = preview.hasAccount ? LABELS.filter((s) => s.id !== 'password') : LABELS;

  return (
    <Card className="shadow-lg">
      <CardContent className="p-6 sm:p-8">
        <WizardProgress
          steps={steps}
          index={steps.findIndex((s) => s.id === w.step)}
          reached={Math.min(w.reached, steps.length - 1)}
          onGo={w.go}
        />
        {formError && (
          <div className="mb-4">
            <Notice variant="error">{formError}</Notice>
          </div>
        )}

        {w.step === 'you' && (
          <form onSubmit={fromYou} noValidate>
            <Heading
              headingRef={w.headingRef}
              lead={`You are creating ${preview.company} at ${preview.slug}.`}
            >
              {first ? `Welcome, ${first}. Is this you?` : 'Welcome. Is this you?'}
            </Heading>
            <div className="space-y-4">
              <div className="bg-muted/40 rounded-xl border px-4 py-3 text-sm">
                <p className="text-muted-foreground">Signing up as</p>
                <p className="font-medium">{preview.email}</p>
              </div>
              <Field label="Your name" htmlFor="name" error={errors.name} shakeKey={shakeKey}>
                <Input
                  autoFocus
                  autoComplete="name"
                  value={a.name}
                  maxLength={100}
                  onChange={(e) => w.set({ name: e.target.value })}
                />
              </Field>
              {preview.hasAccount && (
                <Notice variant="info">
                  You already have a Crew Deck account, so you keep your existing password.
                </Notice>
              )}
            </div>
            <div className="mt-6 flex justify-end">
              <Button type="submit" disabled={busy}>
                {preview.hasAccount ? (busy ? 'Creating…' : 'Create my workspace') : 'Continue'}{' '}
                {!busy && <ArrowRight />}
              </Button>
            </div>
          </form>
        )}

        {w.step === 'password' && (
          <form onSubmit={fromPassword} noValidate>
            <Heading headingRef={w.headingRef} lead="You will use it with your email to sign in.">
              Choose a password
            </Heading>
            <div className="space-y-4">
              <Field
                label="Password"
                htmlFor="password"
                error={errors.password}
                shakeKey={shakeKey}
              >
                <PasswordInput
                  autoFocus
                  autoComplete="new-password"
                  value={a.password}
                  onChange={(e) => w.set({ password: e.target.value })}
                />
              </Field>
              <PasswordStrength password={a.password} />
            </div>
            <div className="mt-6 flex items-center justify-between">
              <Button type="button" variant="ghost" onClick={w.back} disabled={busy}>
                <ArrowLeft /> Back
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? (
                  <>
                    <Loader2 className="animate-spin" /> Creating…
                  </>
                ) : (
                  'Create my workspace'
                )}
              </Button>
            </div>
          </form>
        )}

        {w.step === 'done' && (
          <div className="space-y-5 text-center" role="status">
            <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
              <PartyPopper className="size-7" aria-hidden />
            </span>
            <h1
              ref={w.headingRef}
              tabIndex={-1}
              className="text-2xl font-semibold tracking-tight outline-none sm:text-3xl"
            >
              {preview.company} is ready
            </h1>
            <p className="text-muted-foreground">
              Taking you to {preview.slug} now. Your trial has started.
            </p>
            <ul className="mx-auto max-w-xs space-y-1.5 text-left text-sm">
              {['Workspace created', 'You are the owner', 'Business trial started'].map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-emerald-600" aria-hidden /> {t}
                </li>
              ))}
            </ul>
            <Button type="button" onClick={() => a.url && window.location.assign(a.url)}>
              Open my workspace <ArrowRight />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function VerifyInner() {
  const token = useSearchParams().get('token') ?? '';
  const preview = useQuery({
    queryKey: ['signup-preview', token],
    queryFn: () => api<Preview>('/signup/preview', { body: { token } }),
    enabled: token.length > 0,
    retry: false,
    staleTime: Infinity,
  });
  if (!token || preview.isError) return <Expired />;
  if (preview.isPending)
    return <Skeleton role="status" aria-label="Loading" className="h-96 w-full rounded-2xl" />;
  return <VerifyWizard token={token} preview={preview.data} />;
}

export default function VerifyPage() {
  return (
    <Suspense
      fallback={<Skeleton role="status" aria-label="Loading" className="h-96 w-full rounded-2xl" />}
    >
      <VerifyInner />
    </Suspense>
  );
}
