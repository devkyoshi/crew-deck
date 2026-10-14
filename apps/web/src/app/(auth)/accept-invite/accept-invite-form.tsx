'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight } from 'lucide-react';
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
import { api, ApiError, type Providers } from '@/lib/api';

const STEPS = ['you', 'password'] as const;
const LABELS = [
  { id: 'you', label: 'You' },
  { id: 'password', label: 'Password' },
];

interface Answers {
  name: string;
  password: string;
  timezone: string;
}
type Preview = { email: string; orgName: string; orgSlug: string };

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

function Wizard({
  token,
  preview,
  onInvalid,
}: {
  token: string;
  preview: Preview;
  onInvalid: () => void;
}) {
  const router = useRouter();
  const w = useWizard<Answers>({
    steps: STEPS,
    initial: {
      name: '',
      password: '',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    },
  });
  const { shakeKey, fail } = useFormFeedback();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const a = w.data;

  async function accept() {
    setBusy(true);
    setFormError(null);
    try {
      await api('/auth/invite/accept', {
        body: { token, name: a.name.trim(), password: a.password, timezone: a.timezone },
      });
      router.replace('/');
      router.refresh();
    } catch (e) {
      const err = e as ApiError;
      if (err.code === 'invalid_invitation') onInvalid();
      else if (err.code === 'domain_not_allowed')
        setFormError('Your email is not on this workspace’s domain.');
      else setFormError(err.message);
      fail();
      setBusy(false);
    }
  }

  if (!w.ready)
    return <Skeleton role="status" aria-label="Loading" className="h-80 w-full rounded-2xl" />;
  const first = a.name.trim().split(/\s+/)[0];

  return (
    <Card className="shadow-lg">
      <CardContent className="p-6 sm:p-8">
        <WizardProgress steps={LABELS} index={w.index} reached={w.reached} onGo={w.go} />
        {formError && (
          <div className="mb-4">
            <Notice variant="error">{formError}</Notice>
          </div>
        )}

        {w.step === 'you' && (
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (!a.name.trim()) {
                setErrors({ name: 'Tell us what to call you' });
                return fail();
              }
              setErrors({});
              w.next({ name: a.name.trim() });
            }}
          >
            <Heading
              headingRef={w.headingRef}
              lead={
                <>
                  Set up your account for{' '}
                  <span className="text-foreground font-medium">{preview.email}</span>.
                </>
              }
            >
              Join {preview.orgName}
            </Heading>
            <Field label="Your full name" htmlFor="name" error={errors.name} shakeKey={shakeKey}>
              <Input
                autoFocus
                autoComplete="name"
                value={a.name}
                maxLength={100}
                onChange={(e) => w.set({ name: e.target.value })}
              />
            </Field>
            <div className="mt-6 flex justify-end">
              <Button type="submit">
                Continue <ArrowRight />
              </Button>
            </div>
          </form>
        )}

        {w.step === 'password' && (
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (a.password.length < MIN_PASSWORD) {
                setErrors({ password: `Use at least ${MIN_PASSWORD} characters` });
                return fail();
              }
              setErrors({});
              void accept();
            }}
          >
            <Heading headingRef={w.headingRef} lead="You will use it with your email to sign in.">
              {first ? `Nearly there, ${first}. Choose a password` : 'Choose a password'}
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
                {busy ? 'Joining…' : `Join ${preview.orgName}`}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function Inner({ token }: { token: string }) {
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [invalid, setInvalid] = useState(!token);

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

  if (invalid) {
    return (
      <Card className="shadow-lg">
        <CardContent className="space-y-4 p-6 sm:p-8">
          <h1 className="text-2xl font-semibold tracking-tight">This invitation is not valid</h1>
          <p className="text-muted-foreground">
            The link is invalid, already used, or has expired. Ask a workspace admin to send you a
            new invitation.
          </p>
          <Button variant="outline" onClick={() => router.push('/sign-in')}>
            Go to sign in
          </Button>
        </CardContent>
      </Card>
    );
  }
  if (!preview) {
    return (
      <Skeleton role="status" aria-label="Loading invitation" className="h-80 w-full rounded-2xl" />
    );
  }
  return <Wizard token={token} preview={preview} onInvalid={() => setInvalid(true)} />;
}

export function AcceptInviteForm({ token }: { token: string }) {
  return (
    <Suspense
      fallback={<Skeleton role="status" aria-label="Loading" className="h-80 w-full rounded-2xl" />}
    >
      <Inner token={token} />
    </Suspense>
  );
}
