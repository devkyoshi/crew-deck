'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, LogOut, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { PasswordStrength, MIN_PASSWORD } from '@/components/auth/password-strength';
import { Notice } from '@/components/shared/notice';
import { useMe } from '@/components/shell/me-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { PasswordInput } from '@/components/ui/password-input';
import { Switch } from '@/components/ui/switch';
import { api, ApiError } from '@/lib/api';

/** Change the password, and end the sessions on other devices. */
export function SecurityPanel({ forced = false }: { forced?: boolean }) {
  const { user } = useMe();
  const router = useRouter();
  const hasPassword = user.hasPassword !== false;
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [signOutOthers, setSignOutOthers] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [others, setOthers] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (hasPassword && !current) found.current = 'Enter your current password';
    if (next.length < MIN_PASSWORD) found.next = `Use at least ${MIN_PASSWORD} characters`;
    if (again !== next) found.again = 'The two passwords do not match';
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      const r = await api<{ signedOutElsewhere: number }>('/me/password', {
        method: 'POST',
        body: { current: hasPassword ? current : undefined, next, signOutOthers },
      });
      toast.success(
        r.signedOutElsewhere
          ? `Password changed. ${r.signedOutElsewhere} other session${r.signedOutElsewhere === 1 ? '' : 's'} signed out.`
          : 'Password changed',
      );
      setCurrent('');
      setNext('');
      setAgain('');
      router.refresh();
      // Someone who had to replace a temporary password can now use the app.
      if (forced) router.replace('/');
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      else toast.error(err instanceof ApiError ? err.message : 'Could not change the password');
    } finally {
      setBusy(false);
    }
  }

  async function signOutElsewhere() {
    setOthers(true);
    try {
      const r = await api<{ ended: number }>('/me/sessions/sign-out-others', { method: 'POST', body: {} });
      toast.success(r.ended ? `Signed out of ${r.ended} other session${r.ended === 1 ? '' : 's'}` : 'No other sessions were signed in');
    } catch {
      toast.error('Could not sign out the other sessions');
    } finally {
      setOthers(false);
    }
  }

  return (
    <div className="space-y-6">
      {forced && (
        <Notice variant="warning">
          An admin set a temporary password for you. Choose your own now to continue.
        </Notice>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4" strokeWidth={1.5} aria-hidden />
            {hasPassword ? 'Change password' : 'Set a password'}
          </CardTitle>
          <CardDescription>
            {hasPassword
              ? `Use at least ${MIN_PASSWORD} characters. A few random words works well.`
              : 'You signed in with Google. A password lets you sign in with your email too.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={save} className="max-w-md space-y-4" noValidate>
            {hasPassword && (
              <Field label="Current password" htmlFor="pw-current" error={errors.current}>
                <PasswordInput
                  id="pw-current"
                  autoComplete="current-password"
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                />
              </Field>
            )}
            <Field label="New password" htmlFor="pw-next" error={errors.next}>
              <PasswordInput
                id="pw-next"
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
              />
            </Field>
            <PasswordStrength password={next} />
            <Field label="Repeat the new password" htmlFor="pw-again" error={errors.again}>
              <PasswordInput
                id="pw-again"
                autoComplete="new-password"
                value={again}
                onChange={(e) => setAgain(e.target.value)}
              />
            </Field>
            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <label htmlFor="pw-others" className="text-sm">
                <span className="block font-medium">Sign out on other devices</span>
                <span className="text-muted-foreground text-xs">
                  Ends every other session once the password is changed.
                </span>
              </label>
              <Switch id="pw-others" checked={signOutOthers} onCheckedChange={setSignOutOthers} />
            </div>
            <Button type="submit" loading={busy}>
              {hasPassword ? 'Change password' : 'Set password'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4" strokeWidth={1.5} aria-hidden />
            Sessions
          </CardTitle>
          <CardDescription>
            You are signed in as {user.email}. If you used a shared computer, sign out everywhere
            else.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" variant="outline" onClick={signOutElsewhere} loading={others}>
            <LogOut /> Sign out of other sessions
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
