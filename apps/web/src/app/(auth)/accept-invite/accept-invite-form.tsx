'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Notice } from '@/components/shared/notice';
import { MIN_PASSWORD, PasswordStrength } from '@/components/auth/password-strength';
import { useWizard } from '@/components/auth/wizard';
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
import { api, ApiError, type Providers } from '@/lib/api';

const STEPS = ['you', 'password'] as const;
const SHELL_STEPS: ShellStep[] = [
  { id: 'you', label: 'Personal details', hint: 'Just a bit about you' },
  { id: 'password', label: 'Password', hint: 'Secure your account' },
];

interface Answers {
  name: string;
  password: string;
  timezone: string;
}
type Preview = { email: string; orgName: string; orgSlug: string };

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

  if (!w.ready) return <SetupLoading />;
  const first = a.name.trim().split(/\s+/)[0];

  return (
    <WizardShell steps={SHELL_STEPS} current={w.step} reachedId={STEPS[w.reached]} onGo={w.go}>
      {formError && (
        <div className="mb-5">
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
          <StepHero
            headingRef={w.headingRef}
            title={`Join ${preview.orgName}`}
            lead={
              <>
                Set up your account for{' '}
                <span className="text-foreground font-medium">{preview.email}</span>.
              </>
            }
          />
          <FieldStack>
            <FieldGroup title="About you">
              <Field label="Your full name" htmlFor="name" error={errors.name} shakeKey={shakeKey}>
                <Input
                  autoFocus
                  autoComplete="name"
                  placeholder="Jane Doe"
                  className={bigInput}
                  value={a.name}
                  maxLength={100}
                  onChange={(e) => w.set({ name: e.target.value })}
                />
              </Field>
            </FieldGroup>
          </FieldStack>
          <StepFooter next="Continue" left={<span />} />
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
          <StepHero
            headingRef={w.headingRef}
            title={first ? `Nearly there, ${first}. Choose a password` : 'Choose a password'}
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
            next={busy ? 'Joining…' : `Join ${preview.orgName}`}
            onBack={busy ? undefined : w.back}
            loading={busy}
          />
        </form>
      )}
    </WizardShell>
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
      <SetupMessage
        title="This invitation is not valid"
        actions={
          <Button variant="outline" onClick={() => router.push('/sign-in')}>
            Go to sign in
          </Button>
        }
      >
        The link is invalid, already used, or has expired. Ask a workspace admin to send you a new
        invitation.
      </SetupMessage>
    );
  }
  if (!preview) return <SetupLoading />;
  return <Wizard token={token} preview={preview} onInvalid={() => setInvalid(true)} />;
}

export function AcceptInviteForm({ token }: { token: string }) {
  return (
    <Suspense fallback={<SetupLoading />}>
      <Inner token={token} />
    </Suspense>
  );
}
