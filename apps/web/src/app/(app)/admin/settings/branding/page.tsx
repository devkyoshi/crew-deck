'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Lock, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { EmptyState } from '@/components/shared/empty-state';
import { Notice } from '@/components/shared/notice';
import { PageHeader } from '@/components/shared/page-header';
import { useIsAdmin, useMe } from '@/components/shell/me-context';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { api, ApiError } from '@/lib/api';
import { useHasFeature } from '@/lib/plans';

function Locked({ what }: { what: string }) {
  return (
    <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
      <Lock className="size-3" aria-hidden /> {what} is not in your plan.{' '}
      <Link href="/admin/billing" className="text-primary underline-offset-4 hover:underline">
        See plans
      </Link>
    </p>
  );
}

export default function BrandingPage() {
  const isAdmin = useIsAdmin();
  const me = useMe();
  const router = useRouter();
  const canName = useHasFeature('branding_name');
  const canLook = useHasFeature('branding_full');
  const canLock = useHasFeature('domain_lock');
  const [name, setName] = useState(me.org.name);
  const [logoUrl, setLogoUrl] = useState(me.org.logoUrl ?? '');
  const [accent, setAccent] = useState(me.org.accentColor ?? '');
  const [lock, setLock] = useState(me.org.domainRestricted);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  if (!isAdmin) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Admins only"
        description="You need to be a workspace admin to change branding."
      />
    );
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = {};
    if (canName && name.trim() !== me.org.name) body.name = name.trim();
    if (canLook) {
      if ((logoUrl.trim() || null) !== me.org.logoUrl) body.logoUrl = logoUrl.trim() || null;
      if ((accent.trim() || null) !== me.org.accentColor) body.accentColor = accent.trim() || null;
    }
    if (canLock && lock !== me.org.domainRestricted) body.domainRestricted = lock;
    if (Object.keys(body).length === 0) return toast.message('Nothing to save');
    setBusy(true);
    setErrors({});
    try {
      await api('/settings/branding', { method: 'PUT', body });
      toast.success('Saved');
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      else toast.error(err instanceof ApiError ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        title="Branding and access"
        description="How your workspace looks, and who can be invited."
      />
      <form onSubmit={save} className="space-y-6" noValidate>
        <section className="bg-card space-y-4 rounded-2xl border p-5">
          <h2 className="font-semibold">Workspace</h2>
          <Field label="Workspace name" htmlFor="brand-name" error={errors.name}>
            <Input
              value={name}
              maxLength={80}
              disabled={!canName}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          {!canName && <Locked what="Renaming the workspace" />}
          <Field
            label="Logo address"
            htmlFor="brand-logo"
            error={errors.logoUrl}
            hint="A link to an image that starts with https://"
          >
            <Input
              value={logoUrl}
              placeholder="https://example.com/logo.png"
              disabled={!canLook}
              onChange={(e) => setLogoUrl(e.target.value)}
            />
          </Field>
          <div className="space-y-1.5">
            <Field
              label="Accent colour"
              htmlFor="brand-accent"
              error={errors.accentColor}
              hint="Used for buttons and highlights. Pick a darker colour so white text stays readable."
            >
              <Input
                value={accent}
                placeholder="#2f5bff"
                disabled={!canLook}
                onChange={(e) => setAccent(e.target.value.trim())}
              />
            </Field>
          </div>
          {!canLook && <Locked what="Logo and accent colour" />}
        </section>

        <section className="bg-card space-y-3 rounded-2xl border p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <label htmlFor="domain-lock" className="font-semibold">
                Only invite people on {me.org.domain}
              </label>
              <p className="text-muted-foreground text-sm">
                When on, invitations and Google sign-in are limited to your company email domain.
              </p>
            </div>
            <Switch id="domain-lock" checked={lock} disabled={!canLock} onCheckedChange={setLock} />
          </div>
          {!canLock && <Locked what="Locking invitations to your domain" />}
          {!canLock && (
            <Notice variant="info">On your plan, you can invite anyone by email.</Notice>
          )}
        </section>

        <Button type="submit" disabled={busy || (!canName && !canLook && !canLock)}>
          {busy ? 'Saving…' : 'Save changes'}
        </Button>
      </form>
    </div>
  );
}
