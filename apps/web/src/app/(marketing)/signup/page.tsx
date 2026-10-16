'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useQueries, useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  Loader2,
  Mail,
  Pencil,
  Sparkles,
} from 'lucide-react';
import { suggestedUsageFor, USAGE_OPTIONS, type WorkType } from '@crew-deck/shared';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/shared/notice';
import { useWizard } from '@/components/auth/wizard';
import {
  UsagePicker,
  WorkTypeMultiPicker,
  workTypesLabel,
} from '@/components/workspace/work-type-picker';
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
import { FriendlyAvatarsIllustration } from '@/components/illustrations/jira-illustrations';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;
const STEPS = ['you', 'company', 'work', 'usage', 'review', 'sent'] as const;
const SHELL_STEPS: ShellStep[] = [
  { id: 'you', code: 'You', label: 'Personal details', hint: 'Just a bit about you' },
  { id: 'company', code: 'Company', label: 'Company info', hint: 'Tell us about your business' },
  { id: 'work', code: 'Work', label: 'Kind of work', hint: 'What does your team do?' },
  { id: 'usage', code: 'Usage', label: 'How you will use it', hint: 'Pick what fits your team' },
  { id: 'review', code: 'Review', label: 'Review details', hint: 'Confirm and submit' },
  { id: 'sent', code: 'Email', label: 'Email verification', hint: 'Check your inbox' },
];

interface Answers {
  name: string;
  email: string;
  company: string;
  slug: string;
  slugTouched: boolean;
  workTypes: WorkType[];
  usage: string[];
  sentAt: number | null;
  devLink: string | null;
}
const INITIAL: Answers = {
  name: '',
  email: '',
  company: '',
  slug: '',
  slugTouched: false,
  workTypes: [],
  usage: [],
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
  const initialRef = useRef(false);
  useEffect(() => {
    if (!initialRef.current && value) {
      initialRef.current = true;
      setV(value);
      return;
    }
    initialRef.current = true;
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
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
  const a = { ...INITIAL, ...w.data };
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

  async function nextFrom(step: string) {
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
      else {
        let available = check.data?.available;
        let reason = check.data?.reason;
        if (available === undefined) {
          try {
            const res = await api<{ available: boolean; reason: string | null }>(
              `/signup/check?slug=${encodeURIComponent(a.slug)}`,
            );
            available = res.available;
            reason = res.reason;
          } catch {
            /* ignore network check failure */
          }
        }
        if (available === false) {
          next.slug = reason ?? 'That address is not available';
        }
      }
    }
    if (step === 'work' && a.workTypes.length === 0) {
      next.workTypes = 'Choose at least one kind of work your company does';
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
        body: {
          email: a.email,
          company: a.company,
          slug: a.slug,
          name: a.name || undefined,
          workTypes: a.workTypes,
          usage: a.usage,
        },
      });
      setNow(Date.now());
      w.next({ sentAt: Date.now(), devLink: res.devLink ?? null });
    } catch (err) {
      if (err instanceof ApiError && err.fields && Object.keys(err.fields).length) {
        // A problem with an earlier answer sends you back to fix it.
        setErrors(err.fields);
        w.go(err.fields.email ? 'you' : err.fields.workType || err.fields.workTypes || err.fields.usage ? 'work' : 'company');
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

  if (!w.ready) return <SetupLoading />;
  if (config.data && !config.data.signupsEnabled) {
    return (
      <SetupMessage title="Sign-ups are closed right now">
        We are not taking new workspaces at the moment. Please contact us and we will help.
      </SetupMessage>
    );
  }

  const enter = (step: string) => (e: React.FormEvent) => {
    e.preventDefault();
    nextFrom(step);
  };

  const err = formError && (
    <div className="mb-5">
      <Notice variant="error">{formError}</Notice>
    </div>
  );

  return (
    <WizardShell
      steps={SHELL_STEPS}
      current={w.step}
      reachedId={STEPS[w.reached]}
      onGo={w.go}
    >
      {err}

      {w.step === 'you' && (
        <form onSubmit={enter('you')} noValidate>
          <StepHero
            headingRef={w.headingRef}
            art={<FriendlyAvatarsIllustration className="mb-2" />}
            title="Let’s set up your workspace"
            lead={`Free for ${trial} days, no card needed. We just need a couple of details to begin.`}
          />
          <FieldStack>
            <Field label="What should we call you?" htmlFor="name" error={errors.name} shakeKey={shakeKey}>
              <Input
                autoFocus
                autoComplete="name"
                placeholder="e.g. Alex Miller"
                className={bigInput}
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
                placeholder="alex@company.com"
                className={bigInput}
                value={a.email}
                onChange={(e) => {
                  clear('email');
                  w.set({ email: e.target.value });
                }}
              />
            </Field>
          </FieldStack>
          <StepFooter
            next="Continue"
            left={
              <Link
                href="/pricing"
                className="text-muted-foreground hover:text-foreground text-sm font-medium underline-offset-4 hover:underline"
              >
                See plans
              </Link>
            }
          />
        </form>
      )}

      {w.step === 'company' && (
        <form onSubmit={enter('company')} noValidate>
          <StepHero
            headingRef={w.headingRef}
            title={
              <>
                {firstName(a.name) ? `Nice to meet you, ${firstName(a.name)}.` : 'Nice to meet you.'}{' '}
                What’s your company called?
              </>
            }
            lead="This is the name your team will see, and the address they sign in at."
          />
          <FieldStack>
            <FieldGroup title="Company">
              <div>
                <Field label="Company name" htmlFor="company" error={errors.company} shakeKey={shakeKey}>
                  <Input
                    autoFocus
                    autoComplete="organization"
                    placeholder="e.g. Acme Corp"
                    className={bigInput}
                    value={a.company}
                    maxLength={80}
                    onChange={(e) => {
                      clear('company');
                      w.set({ company: e.target.value });
                    }}
                  />
                </Field>
                <div className="text-muted-foreground mt-2.5 flex flex-wrap items-center gap-1.5 text-xs">
                  {['Acme Studio', 'Apex Engineering', 'Nova Labs', 'Skyline'].map((ex) => (
                    <button
                      key={ex}
                      type="button"
                      className="border-border hover:border-primary/50 hover:bg-muted rounded-full border px-2.5 py-1 text-[11px] transition-colors"
                      onClick={() => {
                        clear('company');
                        w.set({ company: ex, slug: suggest(ex), slugTouched: false });
                      }}
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              </div>
            </FieldGroup>

            <FieldGroup title="Workspace address">
              <Field
                label="Workspace address"
                htmlFor="slug"
                error={errors.slug ?? (taken ? (check.data?.reason ?? 'That address is not available') : null)}
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
                  className={`${bigInput} font-mono text-sm`}
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
                  <p className="text-muted-foreground text-xs font-medium">Free right now:</p>
                  <div className="flex flex-wrap gap-2">
                    {alternatives.map((alt) => (
                      <Button
                        key={alt.s}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="rounded-full text-xs"
                        onClick={() => w.set({ slug: alt.s, slugTouched: true })}
                      >
                        {alt.s}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </FieldGroup>
          </FieldStack>
          <StepFooter next="Continue" onBack={w.back} />
        </form>
      )}

      {w.step === 'work' && (
        <form onSubmit={enter('work')} noValidate>
          <StepHero
            headingRef={w.headingRef}
            title="What kind of work does your company do?"
            lead="Pick all that apply. This helps us suggest the right columns, modules and templates for your team. You can change it later."
          />
          <WorkTypeMultiPicker
            value={a.workTypes}
            onChange={(workTypes) => {
              clear('workTypes');
              // Choosing kinds of work pre-selects what teams like yours usually need.
              w.set({ workTypes, usage: suggestedUsageFor(workTypes) });
            }}
          />
          {errors.workTypes && (
            <p role="alert" className="text-destructive mt-3 text-sm">
              {errors.workTypes}
            </p>
          )}
          <StepFooter next="Continue" onBack={w.back} />
        </form>
      )}

      {w.step === 'usage' && (
        <form onSubmit={enter('usage')} noValidate>
          <StepHero
            headingRef={w.headingRef}
            title="How does your team plan to use it?"
            lead="Tick everything that applies. We switch on the matching modules, and the rest can be added any time."
          />
          <UsagePicker types={a.workTypes} value={a.usage} onChange={(usage) => w.set({ usage })} showAll />
          <StepFooter next="Continue" onBack={w.back} />
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
          <StepHero
            headingRef={w.headingRef}
            title="Looks good? Here’s what we’ll create"
            lead="Check these, then we will email you a link to confirm."
          />
          <FieldStack>
            <FieldGroup title="You">
              <ReviewRow label="Name" value={a.name} onEdit={() => w.go('you')} />
              <ReviewRow label="Work email" value={a.email} onEdit={() => w.go('you')} />
            </FieldGroup>
            <FieldGroup title="Workspace">
              <ReviewRow label="Company" value={a.company} onEdit={() => w.go('company')} />
              <ReviewRow label="Address" value={`${a.slug}.${domain}`} onEdit={() => w.go('company')} />
              <ReviewRow label="Kind of work" value={workTypesLabel(a.workTypes)} onEdit={() => w.go('work')} />
              <ReviewRow
                label="Usage"
                value={
                  a.usage.length
                    ? a.usage
                        .map((k) => USAGE_OPTIONS.find((o) => o.key === k)?.label ?? k)
                        .slice(0, 2)
                        .join(', ') + (a.usage.length > 2 ? ` +${a.usage.length - 2}` : '')
                    : 'Nothing selected'
                }
                onEdit={() => w.go('usage')}
              />
            </FieldGroup>
            <p className="text-muted-foreground flex items-start gap-2.5 text-[13px] leading-relaxed">
              <Sparkles className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                You start with a <strong className="text-foreground">{trial}-day Business trial</strong>, no
                card needed. After that your workspace moves to Free, and nothing is deleted.{' '}
                <Link href="/pricing" className="underline underline-offset-4">
                  Compare plans
                </Link>
              </span>
            </p>
          </FieldStack>
          <StepFooter next={busy ? 'Sending…' : 'Email me the link'} icon={<Mail />} onBack={w.back} loading={busy} />
        </form>
      )}

      {w.step === 'sent' && (
        <div>
          <StepHero
            headingRef={w.headingRef}
            title="Check your inbox"
            lead={
              <>
                We sent a link to <strong className="text-foreground">{a.email}</strong>. Open it to create{' '}
                <strong className="text-foreground">{a.company}</strong>. It works for 24 hours.
              </>
            }
          />
          <FieldStack>
            {a.devLink && (
              <Notice variant="info">
                Email is not set up on this server, so here is your link:{' '}
                <a className="font-medium underline" href={a.devLink} data-testid="dev-link">
                  Create my workspace
                </a>
              </Notice>
            )}
            <ul className="text-muted-foreground space-y-2 text-sm">
              <li className="flex gap-2.5">
                <Building2 className="mt-0.5 size-4 shrink-0" aria-hidden /> Nothing is created until you
                open the link.
              </li>
              <li className="flex gap-2.5">
                <Mail className="mt-0.5 size-4 shrink-0" aria-hidden /> Nothing there? Check spam, or the
                address may be mistyped.
              </li>
            </ul>
          </FieldStack>
          <div className="mt-9 flex flex-wrap items-center justify-between gap-2">
            <Button type="button" variant="ghost" onClick={() => w.go('you')}>
              <ArrowLeft /> Change my details
            </Button>
            <Button
              type="button"
              variant="outline"
             
              disabled={busy || waitLeft > 0}
              onClick={() => void send()}
            >
              {waitLeft > 0 ? `Send again in ${waitLeft}s` : busy ? 'Sending…' : 'Send it again'}
            </Button>
          </div>
        </div>
      )}
    </WizardShell>
  );
}

function ReviewRow({ label, value, onEdit }: { label: string; value: string; onEdit: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex min-w-0 items-center gap-2 font-medium">
        <span className="truncate">{value}</span>
        <button
          type="button"
          onClick={onEdit}
          className="text-primary shrink-0 rounded p-1"
          aria-label={`Change ${label.toLowerCase()}`}
        >
          <Pencil className="size-3.5" aria-hidden />
        </button>
      </span>
    </div>
  );
}

export default function SignUpPage() {
  return (
    <Suspense fallback={<SetupLoading />}>
      <SignUpWizard />
    </Suspense>
  );
}
