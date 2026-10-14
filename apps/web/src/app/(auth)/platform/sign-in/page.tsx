'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { SplitHeading } from '@/components/auth/auth-split-layout';
import { Notice } from '@/components/shared/notice';
import { useFormFeedback } from '@/hooks/use-form-feedback';
import { api, ApiError } from '@/lib/api';

/** Sign-in for people who run the whole product. Workspace accounts do not work here. */
export default function PlatformSignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { shakeKey, fail } = useFormFeedback();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError('Enter your email and password');
      return fail();
    }
    setBusy(true);
    try {
      await api('/platform/auth/login', { body: { email: email.trim().toLowerCase(), password } });
      router.replace('/platform');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in');
      fail();
      setBusy(false);
    }
  }

  return (
    <>
      <SplitHeading
        icon={
          <span className="bg-primary/10 text-primary flex size-12 items-center justify-center rounded-xl">
            <ShieldAlert className="size-6" aria-hidden />
          </span>
        }
        title="Platform sign in"
        lead="For Crew Deck administrators only."
      />
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Notice variant="error">{error}</Notice>}
        <Field label="Email" htmlFor="platform-email" shakeKey={shakeKey}>
          <Input
            id="platform-email"
            type="email"
            autoComplete="username"
            placeholder="admin@crewdeck.internal"
            className="h-11 rounded-lg"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Password" htmlFor="platform-password" shakeKey={shakeKey}>
          <PasswordInput
            id="platform-password"
            autoComplete="current-password"
            placeholder="••••••••••••"
            className="h-11 rounded-lg"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Button type="submit" className="h-11 w-full rounded-lg font-medium" loading={busy}>
          {busy ? 'Signing in…' : 'Sign In'} {!busy && <ArrowRight />}
        </Button>
      </form>
    </>
  );
}
