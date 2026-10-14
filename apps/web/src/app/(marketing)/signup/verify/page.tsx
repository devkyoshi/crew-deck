'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Notice } from '@/components/shared/notice';
import { MIN_PASSWORD, PasswordStrength } from '@/components/auth/password-strength';
import { useWizard } from '@/components/auth/wizard';
import { workTypeLabel } from '@/components/workspace/work-type-picker';
import {
  bigInput,
  FieldGroup,
  FieldStack,
  SetupLoading,
  SetupMessage,
  StepFooter,
  StepHero,
  WizardShell,
  type ShellStep,
} from '@/components/auth/wizard-shell';
import { useFormFeedback } from '@/hooks/use-form-feedback';
import { api, ApiError } from '@/lib/api';

const STEPS = ['you', 'password', 'done'] as const;
const SHELL_STEPS: ShellStep[] = [
  { id: 'you', label: 'Confirm details', hint: 'Make sure this is you' },
  { id: 'password', label: 'Password', hint: 'Secure your account' },
  { id: 'done', label: 'Ready', hint: 'Your workspace is live' },
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
  workType?: string | null;
}

function Expired() {
  return (
    <SetupMessage
      title="This link has expired"
      actions={
        <>
          <Button asChild>
            <Link href="/signup">Start again</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/workspaces">Find my workspace</Link>
          </Button>
        </>
      }
    >
      Sign-up links work once and last 24 hours. If you already used it, your workspace exists: find it
      and sign in. Otherwise start again and we will send a fresh one.
    </SetupMessage>
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

  if (!w.ready) return <SetupLoading />;

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
  const steps = preview.hasAccount ? SHELL_STEPS.filter((s) => s.id !== 'password') : SHELL_STEPS;

  return (
    <WizardShell steps={steps} current={w.step} reachedId={STEPS[w.reached]} onGo={w.go}>
      {formError && (
        <div className="mb-5">
          <Notice variant="error">{formError}</Notice>
        </div>
      )}

      {w.step === 'you' && (
        <form onSubmit={fromYou} noValidate>
          <StepHero
            headingRef={w.headingRef}
            title={first ? `Welcome, ${first}. Is this you?` : 'Welcome. Is this you?'}
            lead={`You are creating ${preview.company} at ${preview.slug}${preview.workType ? `, set up for ${workTypeLabel(preview.workType).toLowerCase()}` : ''}.`}
          />
          <FieldStack>
            <FieldGroup title="Account">
              <div className="space-y-1">
                <p className="text-muted-foreground text-xs">Signing up as</p>
                <p className="text-[15px] font-medium">{preview.email}</p>
              </div>
              <Field label="Your name" htmlFor="name" error={errors.name} shakeKey={shakeKey}>
                <Input
                  autoFocus
                  autoComplete="name"
                  placeholder="Your full name"
                  className={bigInput}
                  value={a.name}
                  maxLength={100}
                  onChange={(e) => w.set({ name: e.target.value })}
                />
              </Field>
            </FieldGroup>
            {preview.hasAccount && (
              <Notice variant="info">
                You already have a Crew Deck account, so you keep your existing password.
              </Notice>
            )}
          </FieldStack>
          <StepFooter
            next={preview.hasAccount ? (busy ? 'Creating…' : 'Create my workspace') : 'Continue'}
            loading={busy}
            left={<span />}
          />
        </form>
      )}

      {w.step === 'password' && (
        <form onSubmit={fromPassword} noValidate>
          <StepHero
            headingRef={w.headingRef}
            title="Choose a password"
            lead="You will use it with your email to sign in."
          />
          <FieldStack>
            <Field label="Password" htmlFor="password" error={errors.password} shakeKey={shakeKey}>
              <PasswordInput
                autoFocus
                autoComplete="new-password"
                placeholder="••••••••••••"
                className={bigInput}
                value={a.password}
                onChange={(e) => w.set({ password: e.target.value })}
              />
            </Field>
            <PasswordStrength password={a.password} />
          </FieldStack>
          <StepFooter
            next={busy ? 'Creating…' : 'Create my workspace'}
            onBack={busy ? undefined : w.back}
            loading={busy}
          />
        </form>
      )}

      {w.step === 'done' && (
        <div role="status">
          <StepHero
            headingRef={w.headingRef}
            title={`${preview.company} is ready`}
            lead={`Taking you to ${preview.slug} now. Your trial has started.`}
          />
          <FieldStack>
            <ul className="space-y-2.5">
              {['Workspace created', 'You are the owner', 'Business trial started'].map((t) => (
                <li key={t} className="flex items-center gap-2.5 text-sm font-medium">
                  <CheckCircle2 className="size-4 shrink-0 text-emerald-600" aria-hidden />
                  {t}
                </li>
              ))}
            </ul>
          </FieldStack>
          <div className="mt-9">
            <Button
              type="button"
              
              onClick={() => a.url && window.location.assign(a.url)}
            >
              Open my workspace <ArrowRight />
            </Button>
          </div>
        </div>
      )}
    </WizardShell>
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
  if (preview.isPending) return <SetupLoading />;
  return <VerifyWizard token={token} preview={preview.data} />;
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<SetupLoading />}>
      <VerifyInner />
    </Suspense>
  );
}
