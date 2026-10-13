'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertCircle, FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { api, ApiError, type Providers } from '@/lib/api';

const ERRORS: Record<string, string> = {
  domain_not_allowed: 'That Google account is not on this workspace’s email domain.',
  not_invited: 'You have not been invited to this workspace yet. Ask an admin for an invite.',
  account_inactive: 'This account has been deactivated. Contact a workspace admin.',
  email_not_verified: 'Your Google email address is not verified.',
  sso_cancelled: 'Google sign-in was cancelled.',
  sso_failed: 'Google sign-in failed. Please try again.',
  tenant_not_found: 'That workspace was not found.',
  invalid_credentials: 'Invalid email or password.',
  rate_limited: 'Too many attempts. Wait a minute and try again.',
};

const schema = z.object({
  email: z.string().trim().min(1, 'Enter your email').email('Enter a valid email'),
  password: z.string().min(1, 'Enter your password'),
});
type Values = z.infer<typeof schema>;

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.5 12.27c0-.79-.07-1.54-.2-2.27H12v4.29h5.9a5.04 5.04 0 0 1-2.19 3.31v2.75h3.54c2.07-1.91 3.25-4.72 3.25-8.08z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.54-2.75c-.98.66-2.24 1.05-3.74 1.05-2.87 0-5.3-1.94-6.17-4.55H2.17v2.84A11 11 0 0 0 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.83 14.09a6.6 6.6 0 0 1 0-4.18V7.07H2.17a11 11 0 0 0 0 9.86l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.17 7.07l3.66 2.84C6.7 7.32 9.13 5.38 12 5.38z"
      />
    </svg>
  );
}

export function SignInForm({ initialError }: { initialError?: string }) {
  const router = useRouter();
  const [providers, setProviders] = useState<Providers | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [formError, setFormError] = useState<string | null>(
    initialError ? (ERRORS[initialError] ?? 'Sign-in failed.') : null,
  );
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  useEffect(() => {
    api<Providers>('/auth/providers')
      .then(setProviders)
      .catch(() => setLoadError(true));
  }, []);

  async function signIn(path: string, body: object) {
    setFormError(null);
    try {
      await api(path, { body });
      router.replace('/');
      router.refresh();
    } catch (e) {
      const err = e as ApiError;
      setFormError(ERRORS[err.code] ?? err.message);
    }
  }

  const onSubmit = (v: Values) => signIn('/auth/login', v);

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">
          {providers?.tenant ? `Sign in to ${providers.tenant.name}` : 'Sign in'}
        </CardTitle>
        <CardDescription>Use your work account to continue.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {formError && (
          <div
            role="alert"
            className="border-destructive/30 bg-destructive/5 text-destructive flex items-start gap-2 rounded-md border p-3 text-sm"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {formError}
          </div>
        )}

        {!providers && !loadError && (
          <div className="space-y-3" aria-busy="true" aria-label="Loading sign-in options">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        )}
        {loadError && (
          <p className="text-muted-foreground text-center text-sm">
            Could not load sign-in options. Refresh to try again.
          </p>
        )}

        {providers && !providers.tenant && (
          <p className="text-muted-foreground text-center text-sm">
            Open your workspace address (for example{' '}
            <span className="font-mono">acme.localhost</span>) to sign in.
          </p>
        )}

        {providers?.tenant && (
          <>
            {providers.google && (
              <Button variant="outline" className="w-full" asChild>
                <a href="/api/v1/auth/sso/google">
                  <GoogleIcon /> Continue with Google
                </a>
              </Button>
            )}
            {providers.google && (
              <div className="flex items-center gap-3">
                <Separator className="flex-1" />
                <span className="text-muted-foreground text-xs">or</span>
                <Separator className="flex-1" />
              </div>
            )}
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-3" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  aria-invalid={!!errors.email}
                  aria-describedby={errors.email ? 'email-error' : undefined}
                  {...register('email')}
                />
                {errors.email && (
                  <p id="email-error" className="text-destructive text-xs">
                    {errors.email.message}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  aria-invalid={!!errors.password}
                  aria-describedby={errors.password ? 'password-error' : undefined}
                  {...register('password')}
                />
                {errors.password && (
                  <p id="password-error" className="text-destructive text-xs">
                    {errors.password.message}
                  </p>
                )}
              </div>
              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>

            {providers.devLogin && (
              <DevLogin onSignIn={(email) => signIn('/auth/dev-login', { email })} />
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function DevLogin({ onSignIn }: { onSignIn: (email: string) => Promise<void> }) {
  const [email, setEmail] = useState('');
  return (
    <div className="bg-muted/60 space-y-2 rounded-lg border border-dashed p-3">
      <p className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
        <FlaskConical className="size-3.5" aria-hidden /> Development only
      </p>
      <div className="flex gap-2">
        <Input
          aria-label="Dev login email"
          placeholder="owner@acme.test"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Button
          type="button"
          variant="secondary"
          aria-label="Dev sign in"
          disabled={!email}
          onClick={() => onSignIn(email)}
        >
          Sign in
        </Button>
      </div>
    </div>
  );
}
