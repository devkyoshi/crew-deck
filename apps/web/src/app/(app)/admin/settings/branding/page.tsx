'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Layers, Lock, MessagesSquare, Home, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { EmptyState } from '@/components/shared/empty-state';
import { ImageUpload } from '@/components/shared/image-upload';
import { Notice } from '@/components/shared/notice';
import { PageHeader } from '@/components/shared/page-header';
import { SaveIndicator, useSaveState } from '@/components/shared/save-indicator';
import { useIsAdmin, useMe } from '@/components/shell/me-context';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { api, ApiError } from '@/lib/api';
import { useHasFeature } from '@/lib/plans';
import { cn } from '@/lib/utils';

/** Dark enough for white text (the server checks the same 4.5:1 rule). */
const SWATCHES = [
  { name: 'Slate', hex: '#2b3640' },
  { name: 'Indigo', hex: '#4f46e5' },
  { name: 'Blue', hex: '#2563eb' },
  { name: 'Teal', hex: '#0f766e' },
  { name: 'Green', hex: '#15803d' },
  { name: 'Orange', hex: '#c2410c' },
  { name: 'Rose', hex: '#be123c' },
  { name: 'Purple', hex: '#7e22ce' },
];

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

/** What the chosen colour will look like: a rail tile, a button and a tab, before anything is saved. */
function Preview({ accent, logo, name }: { accent: string; logo: string | null; name: string }) {
  return (
    <div className="bg-muted/50 flex overflow-hidden rounded-xl border" aria-hidden>
      <div className="bg-background flex w-14 flex-col items-center gap-3 border-r py-4">
        {logo ? (
          <img src={logo} alt="" className="size-8 rounded-lg object-cover" />
        ) : (
          <span className="bg-foreground text-background flex size-8 items-center justify-center rounded-lg">
            <Layers className="size-4" strokeWidth={1.5} />
          </span>
        )}
        <span
          className="flex size-9 items-center justify-center rounded-lg text-white"
          style={{ background: accent }}
        >
          <Home className="size-[18px]" strokeWidth={1.5} />
        </span>
        <span className="text-muted-foreground flex size-9 items-center justify-center">
          <MessagesSquare className="size-[18px]" strokeWidth={1.5} />
        </span>
      </div>
      <div className="flex-1 space-y-3 p-4">
        <p className="text-heading">{name}</p>
        <div className="flex gap-5 border-b text-sm">
          <span className="relative pb-2 font-medium">
            Board
            <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full" style={{ background: accent }} />
          </span>
          <span className="text-muted-foreground pb-2">List</span>
          <span className="text-muted-foreground pb-2">Calendar</span>
        </div>
        <span
          className="inline-flex h-8 items-center rounded-md px-3 text-label font-medium text-white"
          style={{ background: accent }}
        >
          Create
        </span>
      </div>
    </div>
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
  const [accent, setAccent] = useState(me.org.accentColor ?? '');
  const [lock, setLock] = useState(me.org.domainRestricted);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const saveState = useSaveState();

  if (!isAdmin) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Admins only"
        description="You need to be a workspace admin to change branding."
      />
    );
  }

  const shown = /^#[0-9a-f]{6}$/i.test(accent) ? accent : SWATCHES[0]!.hex;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = {};
    if (canName && name.trim() !== me.org.name) body.name = name.trim();
    if (canLook && (accent.trim() || null) !== me.org.accentColor) body.accentColor = accent.trim() || null;
    if (canLock && lock !== me.org.domainRestricted) body.domainRestricted = lock;
    if (Object.keys(body).length === 0) return toast.message('Nothing to save');
    setBusy(true);
    setErrors({});
    saveState.markSaving();
    try {
      await api('/settings/branding', { method: 'PUT', body });
      saveState.markSaved();
      toast.success('Branding saved');
      router.refresh();
    } catch (err) {
      saveState.markFailed();
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      else toast.error(err instanceof ApiError ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Branding and access"
        description="How your workspace looks, and who can be invited."
      />
      <form onSubmit={save} onChange={saveState.markDirty} className="space-y-6" noValidate>
        <section className="bg-card space-y-5 rounded-xl border p-6">
          <h2 className="text-heading">Workspace</h2>
          <Field label="Workspace name" htmlFor="brand-name" error={errors.name}>
            <Input
              value={name}
              maxLength={80}
              disabled={!canName}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          {!canName && <Locked what="Renaming the workspace" />}

          <div className="space-y-2">
            <p className="text-sm font-medium">Logo</p>
            {canLook ? (
              <ImageUpload
                endpoint="/org/logo"
                preview={me.org.logoUrl}
                shape="square"
                size={80}
                label="Logo"
                hint="Shown in the sidebar rail and workspace switcher. PNG, JPG or WebP, up to 2 MB."
                fallback={<Layers className="size-7" strokeWidth={1.5} />}
                onChanged={() => router.refresh()}
              />
            ) : (
              <Locked what="Logo and accent colour" />
            )}
          </div>
        </section>

        <section className="bg-card space-y-5 rounded-xl border p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-heading">Accent colour</h2>
              <p className="text-muted-foreground text-sm">
                Used for buttons, tabs and highlights. Pick a dark colour so white text stays readable.
              </p>
            </div>
            {accent && canLook && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setAccent('')}>
                Use default
              </Button>
            )}
          </div>
          <div role="radiogroup" aria-label="Accent colour" className="flex flex-wrap gap-3">
            {SWATCHES.map((s) => {
              const on = shown.toLowerCase() === s.hex && (accent !== '' || s.hex === SWATCHES[0]!.hex);
              return (
                <button
                  key={s.hex}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={s.name}
                  disabled={!canLook}
                  onClick={() => setAccent(s.hex)}
                  style={{ background: s.hex }}
                  className={cn(
                    'flex size-9 items-center justify-center rounded-full text-white outline-none transition-transform duration-150 hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50',
                    on && 'ring-foreground ring-2 ring-offset-2 ring-offset-background',
                  )}
                >
                  {on && <Check className="size-4" strokeWidth={2.5} />}
                </button>
              );
            })}
          </div>
          <Field
            label="Custom colour"
            htmlFor="brand-accent"
            error={errors.accentColor}
            hint="A hex colour like #2f5bff."
          >
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label="Pick a colour"
                value={shown}
                disabled={!canLook}
                onChange={(e) => setAccent(e.target.value)}
                className="size-9 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5 disabled:opacity-50"
              />
              <Input
                value={accent}
                placeholder="#2b3640"
                disabled={!canLook}
                className="max-w-40 font-mono"
                onChange={(e) => setAccent(e.target.value.trim())}
              />
            </div>
          </Field>
          {!canLook && <Locked what="Logo and accent colour" />}
          <Preview accent={shown} logo={me.org.logoUrl} name={name || me.org.name} />
        </section>

        <section className="bg-card space-y-3 rounded-xl border p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <label htmlFor="domain-lock" className="text-heading">
                Only invite people on {me.org.domain}
              </label>
              <p className="text-muted-foreground text-sm">
                When on, invitations and Google sign-in are limited to your company email domain.
              </p>
            </div>
            <Switch id="domain-lock" checked={lock} disabled={!canLock} onCheckedChange={setLock} />
          </div>
          {!canLock && <Locked what="Locking invitations to your domain" />}
          {!canLock && <Notice variant="info">On your plan, you can invite anyone by email.</Notice>}
        </section>

        <div className="flex items-center gap-4">
          <Button type="submit" disabled={busy || (!canName && !canLook && !canLock)}>
            {busy ? 'Saving…' : 'Save changes'}
          </Button>
          <SaveIndicator state={saveState.state} />
        </div>
      </form>
    </div>
  );
}
