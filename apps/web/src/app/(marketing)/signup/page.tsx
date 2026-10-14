'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Loader2, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/shared/notice';
import { useFormFeedback } from '@/hooks/use-form-feedback';
import { api, ApiError } from '@/lib/api';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;
const suggest = (company: string) =>
  company
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);

function useDebounced<T>(value: T, ms = 400) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function SignUpPage() {
  const config = useQuery({
    queryKey: ['signup-config'],
    queryFn: () =>
      api<{
        signupsEnabled: boolean;
        blockFreeEmail: boolean;
        trialDays: number;
        baseDomain: string;
      }>('/signup/config'),
  });
  const [company, setCompany] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ email: string; devLink?: string } | null>(null);
  const { shakeKey, fail } = useFormFeedback();

  // The address follows the company name until the person edits it themselves.
  useEffect(() => {
    if (!slugTouched) setSlug(suggest(company));
  }, [company, slugTouched]);

  const dslug = useDebounced(slug);
  const slugOk = SLUG_RE.test(slug) && !slug.includes('--');
  const check = useQuery({
    queryKey: ['slug-check', dslug],
    queryFn: () =>
      api<{ available: boolean; reason: string | null }>(
        `/signup/check?slug=${encodeURIComponent(dslug)}`,
      ),
    enabled: dslug.length > 0,
    staleTime: 10_000,
  });
  const checking = slug !== dslug || check.isFetching;
  const domain = config.data?.baseDomain ?? 'localhost';
  const slugProblem = !slug
    ? null
    : !slugOk
      ? 'Use 3 to 30 lowercase letters, numbers or hyphens'
      : !checking && check.data && !check.data.available
        ? check.data.reason
        : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (company.trim().length < 2) next.company = 'Enter your company name';
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) next.email = 'Enter your work email';
    if (!slugOk) next.slug = 'Use 3 to 30 lowercase letters, numbers or hyphens';
    else if (slugProblem) next.slug = slugProblem;
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length) return fail();
    setBusy(true);
    try {
      const res = await api<{ ok: boolean; devLink?: string }>('/signup', {
        body: { email: email.trim().toLowerCase(), company: company.trim(), slug },
      });
      setSent({ email: email.trim().toLowerCase(), devLink: res.devLink });
    } catch (err) {
      if (err instanceof ApiError && err.fields && Object.keys(err.fields).length) {
        setErrors(err.fields);
      } else {
        setFormError(
          err instanceof ApiError ? err.message : 'Something went wrong. Please try again.',
        );
      }
      fail();
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <Card className="mx-auto mt-10 max-w-md">
        <CardHeader className="items-center text-center">
          <span className="bg-accent text-accent-foreground flex size-12 items-center justify-center rounded-full">
            <Mail className="size-6" aria-hidden />
          </span>
          <CardTitle className="text-xl">Check your email</CardTitle>
          <CardDescription>
            We sent a link to <strong className="text-foreground">{sent.email}</strong>. Open it to
            finish creating your workspace. It works for 24 hours.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-center">
          {sent.devLink && (
            <Notice variant="info">
              Email is not set up on this server, so here is your link:{' '}
              <a className="font-medium underline" href={sent.devLink} data-testid="dev-link">
                Create my workspace
              </a>
            </Notice>
          )}
          <p className="text-muted-foreground text-sm">
            Did not get it? Check spam, or go back and try again.
          </p>
          <Button variant="outline" onClick={() => setSent(null)}>
            Use a different email
          </Button>
        </CardContent>
      </Card>
    );
  }

  const closed = config.data && !config.data.signupsEnabled;

  return (
    <div className="mx-auto max-w-md space-y-6 pt-8">
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Create your workspace</h1>
        <p className="text-muted-foreground">
          {config.data?.trialDays ?? 14} days of everything in Business, no card needed.{' '}
          <Link href="/pricing" className="text-primary underline underline-offset-4">
            See plans
          </Link>
        </p>
      </div>
      <Card>
        <CardContent className="pt-6">
          {closed && (
            <Notice variant="warning">Sign-ups are closed right now. Please contact us.</Notice>
          )}
          {!closed && (
            <form onSubmit={submit} className="space-y-4" noValidate>
              {formError && <Notice variant="error">{formError}</Notice>}
              <Field
                label="Company name"
                htmlFor="company"
                error={errors.company}
                shakeKey={shakeKey}
              >
                <Input
                  autoComplete="organization"
                  value={company}
                  maxLength={80}
                  onChange={(e) => setCompany(e.target.value)}
                />
              </Field>
              <Field
                label="Workspace address"
                htmlFor="slug"
                error={errors.slug ?? slugProblem}
                hint={
                  <span className="inline-flex items-center gap-1.5" aria-live="polite">
                    {slug && slugOk && checking ? (
                      <>
                        <Loader2 className="size-3.5 animate-spin" aria-hidden /> Checking…
                      </>
                    ) : slug && slugOk && check.data?.available ? (
                      <>
                        <CheckCircle2 className="size-3.5 text-emerald-600" aria-hidden />
                        {slug}.{domain} is available
                      </>
                    ) : (
                      <>
                        Your team signs in at {slug || 'your-company'}.{domain}
                      </>
                    )}
                  </span>
                }
                shakeKey={shakeKey}
              >
                <Input
                  autoComplete="off"
                  spellCheck={false}
                  value={slug}
                  maxLength={30}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setSlug(e.target.value.trim().toLowerCase());
                  }}
                />
              </Field>
              <Field
                label="Work email"
                htmlFor="email"
                error={errors.email}
                hint="We email you a link to confirm it. You become the workspace owner."
                shakeKey={shakeKey}
              >
                <Input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? 'Sending…' : 'Email me the link'}
              </Button>
              <p className="text-muted-foreground text-center text-xs">
                Already have a workspace?{' '}
                <Link
                  href="/workspaces"
                  className="text-primary underline underline-offset-4"
                >
                  Sign in
                </Link>
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
