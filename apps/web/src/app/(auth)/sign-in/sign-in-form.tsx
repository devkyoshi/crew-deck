'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowRight, FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { SplitHeading } from '@/components/auth/auth-split-layout';
import { Notice } from '@/components/shared/notice';
import { useFormFeedback } from '@/hooks/use-form-feedback';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { api, ApiError, type Providers } from '@/lib/api';
import { rememberWorkspace } from '@/lib/recent-workspaces';

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
  workspace_suspended: 'This workspace is suspended. Contact your administrator or support.',
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
  const { shakeKey, onInvalid } = useFormFeedback();

  useEffect(() => {
    api<Providers>('/auth/providers')
      .then(setProviders)
      .catch(() => setLoadError(true));
  }, []);

  async function signIn(path: string, body: object) {
    setFormError(null);
    try {
      await api(path, { body });
      if (providers?.tenant)
        rememberWorkspace({ slug: providers.tenant.slug, name: providers.tenant.name });
      router.replace('/');
      router.refresh();
    } catch (e) {
      const err = e as ApiError;
      setFormError(ERRORS[err.code] ?? err.message);
    }
  }

  const onSubmit = (v: Values) => signIn('/auth/login', v);

  return (
    <>
      <SplitHeading
        title={
          providers?.tenant
            ? `Welcome back to ${providers.tenant.name}!`
            : 'Welcome back to Crew Deck!'
        }
        lead="Please enter your details to sign in to your account"
      />

      <div className="space-y-4">
        {formError && <Notice variant="error">{formError}</Notice>}

        {!providers && !loadError && (
          <div className="space-y-3" aria-busy="true" aria-label="Loading sign-in options">
            <Skeleton className="h-11 w-full rounded-lg" />
            <Skeleton className="h-11 w-full rounded-lg" />
            <Skeleton className="h-11 w-full rounded-lg" />
          </div>
        )}
        {loadError && (
          <Notice variant="warning">Could not load sign-in options. Refresh to try again.</Notice>
        )}

        {providers && !providers.tenant && (
          <div className="space-y-3 text-center">
            <p className="text-muted-foreground text-sm">
              Open your workspace address (for example{' '}
              <span className="text-foreground font-mono font-medium">acme.localhost</span>) to sign in.
            </p>
            <Button variant="outline" className="h-11 rounded-lg" asChild>
              <a href="/workspaces">Find my workspace</a>
            </Button>
          </div>
        )}

        {providers?.tenant?.suspended && (
          <Notice variant="error">
            This workspace is suspended, so nobody can sign in right now. Contact your administrator
            or support to have it restored.
          </Notice>
        )}

        {providers?.tenant && !providers.tenant.suspended && (
          <>
            {providers.google && (
              <Button variant="outline" className="h-11 w-full rounded-lg font-medium" asChild>
                <a href="/api/v1/auth/sso/google">
                  <GoogleIcon /> Continue with Google
                </a>
              </Button>
            )}
            {providers.google && (
              <div className="text-muted-foreground flex items-center gap-3 text-xs">
                <Separator className="flex-1" />
                Or sign in with
                <Separator className="flex-1" />
              </div>
            )}
            <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="space-y-4" noValidate>
              <Field label="Email" htmlFor="email" error={errors.email?.message} shakeKey={shakeKey}>
                <Input
                  type="email"
                  autoComplete="username"
                  placeholder="johndoe@mail.com"
                  className="h-11 rounded-lg"
                  {...register('email')}
                />
              </Field>
              <Field
                label="Password"
                htmlFor="password"
                error={errors.password?.message}
                shakeKey={shakeKey}
              >
                <PasswordInput
                  autoComplete="current-password"
                  placeholder="minimum 8 characters"
                  className="h-11 rounded-lg"
                  {...register('password')}
                />
              </Field>
              <Button
                type="submit"
                className="h-11 w-full rounded-lg font-medium"
                loading={isSubmitting}
              >
                {isSubmitting ? 'Signing in…' : 'Sign In'} {!isSubmitting && <ArrowRight />}
              </Button>
            </form>

            <div className="text-center">
              <a
                href="/workspaces"
                className="text-foreground text-sm font-medium underline underline-offset-4"
              >
                Switch workspace
              </a>
            </div>

            {providers.devLogin && (
              <DevLogin onSignIn={(email) => signIn('/auth/dev-login', { email })} />
            )}
          </>
        )}
      </div>
    </>
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
