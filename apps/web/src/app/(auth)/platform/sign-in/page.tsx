'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
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
    <Card>
      <CardHeader className="items-center text-center">
        <CardTitle className="text-xl">Platform sign in</CardTitle>
        <CardDescription>For Crew Deck administrators only.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3" noValidate>
          {error && <Notice variant="error">{error}</Notice>}
          <Field label="Email" htmlFor="platform-email" shakeKey={shakeKey}>
            <Input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Password" htmlFor="platform-password" shakeKey={shakeKey}>
            <PasswordInput
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
