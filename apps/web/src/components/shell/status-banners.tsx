'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Eye, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { daysUntil } from '@/lib/format';
import { useIsAdmin, useMe } from './me-context';

/** A lighter version of the accent for dark surfaces (mixed 45% toward white). */
export function lightenHex(hex: string, amount = 0.45) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `#${c.map((v) => Math.round(v + (255 - v) * amount).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Applies the workspace's accent colour. It sets --brand (light) and --brand-dark (a lighter shade),
 * which the primary, ring and soft tokens in globals.css read when present. Nothing renders.
 */
export function Branding() {
  const { org } = useMe();
  useEffect(() => {
    const root = document.documentElement;
    if (org.accentColor && /^#[0-9a-f]{6}$/i.test(org.accentColor)) {
      root.style.setProperty('--brand', org.accentColor);
      root.style.setProperty('--brand-dark', lightenHex(org.accentColor));
    }
    return () => {
      root.style.removeProperty('--brand');
      root.style.removeProperty('--brand-dark');
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
