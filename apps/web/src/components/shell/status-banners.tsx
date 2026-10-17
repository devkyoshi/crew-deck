'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Eye, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { daysUntil } from '@/lib/format';
import { useIsAdmin, useMe } from './me-context';

/** Applies the workspace's accent colour to the app's primary colour. Nothing renders. */
export function Branding() {
  const { org } = useMe();
  useEffect(() => {
    const root = document.documentElement;
    const names = ['--primary', '--ring', '--sidebar-primary'];
    if (org.accentColor) {
      for (const n of names) root.style.setProperty(n, org.accentColor);
    }
    return () => {
      for (const n of names) root.style.removeProperty(n);
    };
  }, [org.accentColor]);
  return null;
}

/** Messages that apply to the whole workspace: an impersonated visit, or a running trial. */
export function StatusBanners() {
  const me = useMe();
  const isAdmin = useIsAdmin();

  if (me.impersonatedBy) {
    return (
      <div
        role="status"
        className="flex flex-wrap items-center justify-between gap-2 bg-warning-soft px-4 py-2 text-sm text-warning "
      >
        <span className="flex items-center gap-2">
          <Eye className="size-4" aria-hidden />
          Viewing {me.org.name} as {me.user.email} for {me.impersonatedBy}. This visit is read-only
          and is recorded in the audit log.
        </span>
        <button
          type="button"
          className="font-medium underline underline-offset-4"
          onClick={async () => {
            await api('/auth/logout', { method: 'POST', body: {} }).catch(() => undefined);
            const { protocol, host } = window.location;
            window.location.assign(`${protocol}//${host.split('.').slice(1).join('.')}/platform`);
          }}
        >
          Exit
        </button>
      </div>
    );
  }

  if (me.plan.onTrial && me.plan.trialEndsAt) {
    const days = Math.max(0, daysUntil(me.plan.trialEndsAt));
    return (
      <div className="bg-accent text-accent-foreground flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
        <span className="flex items-center gap-2">
          <Sparkles className="size-4" aria-hidden />
          {me.plan.name} trial:{' '}
          {days === 0 ? 'ends today' : `${days} day${days === 1 ? '' : 's'} left`}. After that the
          workspace moves to Free. Nothing is deleted.
        </span>
        {isAdmin && (
          <Link href="/admin/billing" className="font-medium underline underline-offset-4">
            View plans
          </Link>
        )}
      </div>
    );
  }
  return null;
}
