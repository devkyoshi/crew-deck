'use client';

import { useEffect, useState } from 'react';
import { ConfettiBurst } from '@/components/shared/celebrate';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Loader2 } from 'lucide-react';
import { suggestedUsageFor, type WorkType } from '@crew-deck/shared';
import { Notice } from '@/components/shared/notice';
import { PageHeader } from '@/components/shared/page-header';
import { useMe } from '@/components/shell/me-context';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { UsagePicker, WorkTypeMultiPicker } from '@/components/workspace/work-type-picker';
import { useFormFeedback } from '@/hooks/use-form-feedback';
import { api, ApiError } from '@/lib/api';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;
const slugValid = (s: string) => SLUG_RE.test(s) && !s.includes('--');
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

/** A signed-in person starts another workspace. They become its owner and keep their account. */
export default function NewWorkspacePage() {
  const { user } = useMe();
  const [company, setCompany] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [workTypes, setWorkTypes] = useState<WorkType[]>([]);
  const [usage, setUsage] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [burst, setBurst] = useState(0);
  const { shakeKey, fail } = useFormFeedback();

  useEffect(() => {
    if (!slugTouched) setSlug(suggest(company));
  }, [company, slugTouched]);

  const dslug = useDebounced(slug);
  const check = useQuery({
    queryKey: ['workspace-slug-check', dslug],
    queryFn: () =>
      api<{ available: boolean; reason: string | null }>(
        `/workspaces/check?slug=${encodeURIComponent(dslug)}`,
      ),
    enabled: dslug.length > 0 && slugValid(dslug),
    staleTime: 10_000,
  });
  const checking = slug !== dslug || check.isFetching;

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (company.trim().length < 2) next.company = 'Enter a name for the workspace';
    if (!slugValid(slug)) next.slug = 'Use 3 to 30 lowercase letters, numbers or hyphens';
    else if (check.data && !check.data.available) next.slug = check.data.reason ?? 'That address is not available';
    if (workTypes.length === 0) next.workTypes = 'Choose at least one kind of work this workspace is for';
    setErrors(next);
    if (Object.keys(next).length) return fail();
    setBusy(true);
    setFormError(null);
    try {
      const res = await api<{ url: string }>('/workspaces', {
        body: { company: company.trim(), slug, workTypes, usage },
      });
      // The new workspace has its own address; the link signs you straight in.
      setBurst(1);
      await new Promise((r) => setTimeout(r, 900));
      window.location.assign(res.url);
    } catch (err) {
      if (err instanceof ApiError && err.fields && Object.keys(err.fields).length) setErrors(err.fields);
      else setFormError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      fail();
      setBusy(false);
    }
  }

  // Read the address after mount, so the server render and the first client render match.
  const [domain, setDomain] = useState('localhost');
  useEffect(() => setDomain(window.location.host.split('.').slice(1).join('.')), []);

  return (
    <div className="max-w-3xl">
      <ConfettiBurst burst={burst} />
      <PageHeader
        title="Create a workspace"
        description={`You will be its owner. It uses your existing account (${user.email}), so there is nothing new to sign up for.`}
        action={
          <Button asChild variant="ghost">
            <Link href="/my-workspaces">
              <ArrowLeft /> Back
            </Link>
          </Button>
        }
      />
      {formError && (
        <div className="mb-4">
          <Notice variant="error">{formError}</Notice>
        </div>
      )}
      <form onSubmit={create} noValidate className="space-y-8">
        <section className="bg-card space-y-4 rounded-lg border p-5">
          <h2 className="font-semibold">Name and address</h2>
          <Field label="Workspace name" htmlFor="ws-company" error={errors.company} shakeKey={shakeKey}>
            <Input
              id="ws-company"
              autoFocus
              value={company}
              maxLength={80}
              placeholder="e.g. Buildwell Construction"
              onChange={(e) => setCompany(e.target.value)}
            />
          </Field>
          <Field
            label="Workspace address"
            htmlFor="ws-slug"
            error={errors.slug ?? (check.data && !check.data.available && !checking ? check.data.reason : null)}
            shakeKey={shakeKey}
            hint={
              <span className="inline-flex items-center gap-1.5" aria-live="polite">
                {slug && slugValid(slug) && checking ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" aria-hidden /> Checking…
                  </>
                ) : slug && slugValid(slug) && check.data?.available ? (
                  <>
                    <CheckCircle2 className="size-3.5 text-success-soft-foreground" aria-hidden />
                    {slug}.{domain} is available
                  </>
                ) : (
                  <>
                    Your team signs in at {slug || 'your-company'}.{domain}
                  </>
                )}
              </span>
            }
          >
            <Input
              id="ws-slug"
              value={slug}
              maxLength={30}
              spellCheck={false}
              className="font-mono text-sm"
              onChange={(e) => {
                setSlug(e.target.value.trim().toLowerCase());
                setSlugTouched(true);
              }}
            />
          </Field>
        </section>

        <section className="space-y-3">
          <h2 className="font-semibold">What kind of work does it do? Pick all that apply.</h2>
          <WorkTypeMultiPicker
            value={workTypes}
            onChange={(types) => {
              setWorkTypes(types);
              setUsage(suggestedUsageFor(types));
              setErrors(({ workTypes: _gone, ...rest }) => rest);
            }}
          />
          {errors.workTypes && (
            <p role="alert" className="text-destructive text-sm">
              {errors.workTypes}
            </p>
          )}
        </section>

        {workTypes.length > 0 && (
          <section className="space-y-3">
            <h2 className="font-semibold">How does your team plan to use it?</h2>
            <UsagePicker types={workTypes} value={usage} onChange={setUsage} showAll />
          </section>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" asChild>
            <Link href="/my-workspaces">Cancel</Link>
          </Button>
          <Button type="submit" disabled={busy} data-testid="create-workspace">
            {busy ? 'Creating…' : 'Create workspace'}
          </Button>
        </div>
      </form>
    </div>
  );
}
