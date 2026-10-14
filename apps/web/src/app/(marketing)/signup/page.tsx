'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useQueries, useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  Loader2,
  Mail,
  Pencil,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Notice } from '@/components/shared/notice';
import { useWizard, WizardProgress } from '@/components/auth/wizard';
import { useFormFeedback } from '@/hooks/use-form-feedback';
import { api, ApiError } from '@/lib/api';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;
const STEPS = ['you', 'company', 'review', 'sent'] as const;
const LABELS = [
  { id: 'you', label: 'You' },
  { id: 'company', label: 'Company' },
  { id: 'review', label: 'Review' },
  { id: 'sent', label: 'Email' },
];

interface Answers {
  name: string;
  email: string;
  company: string;
  slug: string;
  slugTouched: boolean;
  sentAt: number | null;
  devLink: string | null;
}
const INITIAL: Answers = {
  name: '',
  email: '',
  company: '',
  slug: '',
  slugTouched: false,
  sentAt: null,
  devLink: null,
};

const suggest = (company: string) =>
  company
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
const firstName = (n: string) => n.trim().split(/\s+/)[0] ?? '';
const slugValid = (s: string) => SLUG_RE.test(s) && !s.includes('--');

function useDebounced<T>(value: T, ms = 400) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
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

function SignUpWizard() {
  const w = useWizard<Answers>({ steps: STEPS, storageKey: 'cd:signup', initial: INITIAL });
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
  const { shakeKey, fail } = useFormFeedback();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const clear = (key: string) => setErrors(({ [key]: _gone, ...rest }) => rest);
  // Put the cursor in the first question when the page opens.
  useEffect(() => {
    if (w.ready && w.step === 'you') document.getElementById('name')?.focus();
  }, [w.ready]);
  const a = w.data;
  const domain = config.data?.baseDomain ?? 'localhost';
  const trial = config.data?.trialDays ?? 14;

  // The address follows the company name until the person types their own.
  const { set } = w;
  useEffect(() => {
    if (w.step === 'company' && !a.slugTouched && a.slug !== suggest(a.company))
      set({ slug: suggest(a.company) });
  }, [set, w.step, a.company, a.slug, a.slugTouched]);

  const dslug = useDebounced(a.slug);
  const check = useQuery({
    queryKey: ['slug-check', dslug],
    queryFn: () =>
      api<{ available: boolean; reason: string | null }>(
        `/signup/check?slug=${encodeURIComponent(dslug)}`,
      ),
    enabled: w.step === 'company' && dslug.length > 0 && slugValid(dslug),
    staleTime: 10_000,
  });
  const checking = a.slug !== dslug || check.isFetching;
  const taken = !checking && !!check.data && !check.data.available && slugValid(a.slug);
  const alternatives = useQueries({
    queries: taken
      ? [
          `${a.slug.slice(0, 27)}-hq`,
          `${a.slug.slice(0, 24)}-team`,
          `${a.slug.slice(0, 26)}-app`,
        ].map((s) => ({
          queryKey: ['slug-alt', s],
          queryFn: () =>
            api<{ available: boolean }>(`/signup/check?slug=${encodeURIComponent(s)}`).then(
              (r) => ({ s, ...r }),
            ),
          staleTime: 10_000,
        }))
      : [],
  })
    .map((q) => q.data)
    .filter((d): d is { s: string; available: boolean } => !!d && d.available);

  // Resend cooldown ticks once a second while it matters.
  const waitLeft = a.sentAt ? Math.max(0, 30 - Math.floor((now - a.sentAt) / 1000)) : 0;
  useEffect(() => {
    if (w.step !== 'sent' || waitLeft === 0) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [w.step, waitLeft]);

  function nextFrom(step: string) {
    setFormError(null);
    const next: Record<string, string> = {};
    if (step === 'you') {
      if (!a.name.trim()) next.name = 'Tell us what to call you';
      if (!/^\S+@\S+\.\S+$/.test(a.email.trim()))
        next.email = 'Enter your work email, like sam@yourcompany.com';
    }
    if (step === 'company') {
      if (a.company.trim().length < 2) next.company = 'Enter your company name';
      if (!slugValid(a.slug)) next.slug = 'Use 3 to 30 lowercase letters, numbers or hyphens';
      else if (checking) next.slug = 'One moment, we are still checking that address';
      else if (check.data && !check.data.available)
        next.slug = check.data.reason ?? 'That address is not available';
    }
    setErrors(next);
    if (Object.keys(next).length) return fail();
    w.next({ email: a.email.trim().toLowerCase(), name: a.name.trim(), company: a.company.trim() });
  }

  async function send() {
    setBusy(true);
    setFormError(null);
    setErrors({});
    try {
      const res = await api<{ ok: boolean; devLink?: string }>('/signup', {
        body: { email: a.email, company: a.company, slug: a.slug, name: a.name || undefined },
      });
      setNow(Date.now());
      w.next({ sentAt: Date.now(), devLink: res.devLink ?? null });
    } catch (err) {
      if (err instanceof ApiError && err.fields && Object.keys(err.fields).length) {
        // A problem with an earlier answer sends you back to fix it.
        setErrors(err.fields);
        w.go(err.fields.email ? 'you' : 'company');
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

  if (!w.ready)
    return <Skeleton role="status" aria-label="Loading" className="h-96 w-full rounded-2xl" />;
  if (config.data && !config.data.signupsEnabled) {
    return (
      <Card>
        <CardContent className="pt-6">
          <Notice variant="warning">Sign-ups are closed right now. Please contact us.</Notice>
        </CardContent>
      </Card>
    );
  }

  const enter = (step: string) => (e: React.FormEvent) => {
    e.preventDefault();
    nextFrom(step);
  };

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
          <form onSubmit={enter('you')} noValidate>
            <Heading
              headingRef={w.headingRef}
              lead={`Free for ${trial} days. We just need a couple of details to begin.`}
            >
              Let’s set up your workspace
            </Heading>
            <div className="space-y-4">
              <Field
                label="What should we call you?"
                htmlFor="name"
                error={errors.name}
                shakeKey={shakeKey}
              >
                <Input
                  autoFocus
                  autoComplete="name"
                  value={a.name}
                  maxLength={100}
                  onChange={(e) => {
                    clear('name');
                    w.set({ name: e.target.value });
                  }}
                />
              </Field>
              <Field
                label="Your work email"
                htmlFor="email"
                error={errors.email}
                hint="We will email you a link to confirm it. You become the workspace owner."
                shakeKey={shakeKey}
              >
                <Input
                  type="email"
                  autoComplete="email"
                  value={a.email}
                  onChange={(e) => {
                    clear('email');
                    w.set({ email: e.target.value });
                  }}
                />
              </Field>
            </div>
            <div className="mt-6 flex items-center justify-between">
              <Link
                href="/pricing"
                className="text-muted-foreground text-sm underline underline-offset-4"
              >
                See plans
              </Link>
              <Button type="submit">
                Continue <ArrowRight />
              </Button>
            </div>
          </form>
        )}

        {w.step === 'company' && (
          <form onSubmit={enter('company')} noValidate>
            <Heading
              headingRef={w.headingRef}
              lead="This is the name your team will see, and the address they sign in at."
            >
              {firstName(a.name) ? `Nice to meet you, ${firstName(a.name)}.` : 'Nice to meet you.'}{' '}
              What’s your company called?
            </Heading>
            <div className="space-y-4">
              <Field
                label="Company name"
                htmlFor="company"
                error={errors.company}
                shakeKey={shakeKey}
              >
                <Input
                  autoFocus
                  autoComplete="organization"
                  value={a.company}
                  maxLength={80}
                  onChange={(e) => {
                    clear('company');
                    w.set({ company: e.target.value });
                  }}
                />
              </Field>
              <Field
                label="Workspace address"
                htmlFor="slug"
                error={
                  errors.slug ??
                  (taken ? (check.data?.reason ?? 'That address is not available') : null)
                }
                hint={
                  <span className="inline-flex items-center gap-1.5" aria-live="polite">
                    {a.slug && slugValid(a.slug) && checking ? (
                      <>
                        <Loader2 className="size-3.5 animate-spin" aria-hidden /> Checking…
                      </>
                    ) : a.slug && slugValid(a.slug) && check.data?.available ? (
                      <>
                        <CheckCircle2 className="size-3.5 text-emerald-600" aria-hidden />
                        {a.slug}.{domain} is available
                      </>
                    ) : (
                      <>
                        Your team signs in at {a.slug || 'your-company'}.{domain}
                      </>
                    )}
                  </span>
                }
                shakeKey={shakeKey}
              >
                <Input
                  autoComplete="off"
                  spellCheck={false}
                  value={a.slug}
                  maxLength={30}
                  onChange={(e) => {
                    clear('slug');
                    w.set({ slug: e.target.value.trim().toLowerCase(), slugTouched: true });
                  }}
                />
              </Field>
              {taken && alternatives.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-muted-foreground text-xs">Free right now:</p>
                  <div className="flex flex-wrap gap-2">
                    {alternatives.map((alt) => (
                      <Button
                        key={alt.s}
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => w.set({ slug: alt.s, slugTouched: true })}
                      >
                        {alt.s}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="mt-6 flex items-center justify-between">
              <Button type="button" variant="ghost" onClick={w.back}>
                <ArrowLeft /> Back
              </Button>
              <Button type="submit">
                Continue <ArrowRight />
              </Button>
            </div>
          </form>
        )}

        {w.step === 'review' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
            noValidate
          >
            <Heading
              headingRef={w.headingRef}
              lead="Check these, then we will email you a link to confirm."
            >
              Looks good? Here’s what we’ll create
            </Heading>
            <dl className="bg-muted/40 divide-y rounded-xl border text-sm">
              {(
                [
                  ['Name', a.name, 'you'],
                  ['Work email', a.email, 'you'],
                  ['Company', a.company, 'company'],
                  ['Address', `${a.slug}.${domain}`, 'company'],
                ] as const
              ).map(([label, value, step]) => (
                <div key={label} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="flex min-w-0 items-center gap-2 font-medium">
                    <span className="truncate">{value}</span>
                    <button
                      type="button"
                      onClick={() => w.go(step)}
                      className="text-primary shrink-0 rounded p-1"
                      aria-label={`Change ${label.toLowerCase()}`}
                    >
                      <Pencil className="size-3.5" aria-hidden />
                    </button>
                  </dd>
                </div>
              ))}
            </dl>
            <div className="bg-accent text-accent-foreground mt-4 flex items-start gap-3 rounded-xl p-4 text-sm">
              <Sparkles className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p>
                You start with a <strong>{trial}-day Business trial</strong>, no card needed. After
                that your workspace moves to Free, and nothing is deleted.{' '}
                <Link href="/pricing" className="underline underline-offset-4">
                  Compare plans
                </Link>
              </p>
            </div>
            <div className="mt-6 flex items-center justify-between">
              <Button type="button" variant="ghost" onClick={w.back}>
                <ArrowLeft /> Back
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'Sending…' : 'Email me the link'} {!busy && <Mail />}
              </Button>
            </div>
          </form>
        )}

        {w.step === 'sent' && (
          <div>
            <Heading headingRef={w.headingRef}>Check your inbox</Heading>
            <div className="space-y-4">
              <div className="bg-accent text-accent-foreground flex items-start gap-3 rounded-xl p-4">
                <Mail className="mt-0.5 size-5 shrink-0" aria-hidden />
                <p className="text-sm">
                  We sent a link to <strong>{a.email}</strong>. Open it to create{' '}
                  <strong>{a.company}</strong>. It works for 24 hours.
                </p>
              </div>
              {a.devLink && (
                <Notice variant="info">
                  Email is not set up on this server, so here is your link:{' '}
                  <a className="font-medium underline" href={a.devLink} data-testid="dev-link">
                    Create my workspace
                  </a>
                </Notice>
              )}
              <ul className="text-muted-foreground space-y-1.5 text-sm">
                <li className="flex gap-2">
                  <Building2 className="mt-0.5 size-4 shrink-0" aria-hidden /> Nothing is created
                  until you open the link.
                </li>
                <li className="flex gap-2">
                  <Mail className="mt-0.5 size-4 shrink-0" aria-hidden /> Nothing there? Check spam,
                  or the address may be mistyped.
                </li>
              </ul>
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                <Button type="button" variant="ghost" onClick={() => w.go('you')}>
                  <ArrowLeft /> Change my details
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || waitLeft > 0}
                  onClick={() => void send()}
                >
                  {waitLeft > 0
                    ? `Send again in ${waitLeft}s`
                    : busy
                      ? 'Sending…'
                      : 'Send it again'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function SignUpPage() {
  return (
    <Suspense
      fallback={<Skeleton role="status" aria-label="Loading" className="h-96 w-full rounded-2xl" />}
    >
      <SignUpWizard />
    </Suspense>
  );
}
