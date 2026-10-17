'use client';

import { motion } from 'framer-motion';
import { CircleCheck, Info, Loader2, OctagonX, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type ToastKind = 'success' | 'error' | 'warning' | 'info' | 'loading';

export const TOAST_TONE: Record<ToastKind, { color: string; icon: LucideIcon }> = {
  success: { color: 'var(--success)', icon: CircleCheck },
  error: { color: 'var(--destructive)', icon: OctagonX },
  warning: { color: 'var(--warning)', icon: TriangleAlert },
  info: { color: 'var(--info)', icon: Info },
  loading: { color: 'var(--muted-foreground)', icon: Loader2 },
};

/** The SVG filter the drop uses to fuse its blobs. Mounted once, next to the Toaster. */
export function ToastGooFilter() {
  return (
    <svg aria-hidden width="0" height="0" className="pointer-events-none absolute">
      <defs>
        <filter id="toast-goo" x="-20%" y="-60%" width="140%" height="220%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="b" />
          <feColorMatrix in="b" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -8" />
        </filter>
      </defs>
    </svg>
  );
}

/**
 * The app's toast: a water drop falls from the top, lands, and spreads into a compact pill. The body is
 * drawn under a goo filter so the drop and the pill fuse; the text sits above it and stays sharp.
 */
export function DropToast({
  kind,
  title,
  description,
  action,
}: {
  kind: ToastKind;
  title: ReactNode;
  description?: ReactNode;
  action?: { label: string; onClick: () => void };
}) {
  const { color, icon: Icon } = TOAST_TONE[kind];
  return (
    <div className="flex w-full justify-center">
      <div
        className="relative inline-block max-w-[min(380px,92vw)]"
        style={{ filter:
            'drop-shadow(0 0 0.6px color-mix(in oklch, var(--foreground) 35%, transparent)) drop-shadow(0 1px 1px rgb(0 0 0 / 0.06)) drop-shadow(0 8px 14px rgb(0 0 0 / 0.14))' }}
      >
        <div aria-hidden className="absolute inset-0" style={{ filter: 'url(#toast-goo)' }}>
          {/* the body: falls, squashes on landing, spreads into the pill */}
          <motion.div
            className="absolute inset-0 rounded-full"
            style={{ background: 'var(--popover)', transformOrigin: '50% 0%' }}
            initial={{ y: -80, scaleX: 0.1, scaleY: 0.5 }}
            animate={{
              y: [-80, 0, 0, 0, 0],
              scaleX: [0.1, 0.1, 1.07, 0.98, 1],
              scaleY: [0.5, 0.5, 0.82, 1.06, 1],
            }}
            transition={{
              duration: 0.85,
              times: [0, 0.36, 0.52, 0.74, 1],
              ease: ['easeIn', 'easeOut', 'easeInOut', 'easeOut'],
            }}
          />
          {/* a smaller droplet trailing behind; the goo fuses it to the top on arrival */}
          <motion.span
            className="absolute left-1/2 -ml-[5px] size-2.5 rounded-full"
            style={{ background: 'var(--popover)' }}
            initial={{ y: -110, opacity: 1 }}
            animate={{ y: [-110, -16, -4, -4], opacity: [1, 1, 0, 0] }}
            transition={{ duration: 0.85, times: [0, 0.34, 0.5, 1], ease: 'easeIn' }}
          />
        </div>

        <motion.div
          role={kind === 'error' ? 'alert' : 'status'}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.55, duration: 0.25 }}
          className="relative flex min-h-9 items-center gap-2 py-1.5 pr-3.5 pl-1.5"
          style={{ color: 'var(--popover-foreground)' }}
        >
          <span
            className="grid size-6 shrink-0 place-items-center rounded-full"
            style={{ background: `color-mix(in oklch, ${color} 16%, transparent)`, color }}
          >
            <Icon className={cn('size-3.5', kind === 'loading' && 'animate-spin')} aria-hidden />
          </span>
          <div className="min-w-0 py-px">
            <p className="text-[13px] leading-tight font-medium">{title}</p>
            {description && <p className="text-muted-foreground text-xs leading-tight">{description}</p>}
          </div>
          {action && (
            <button
              type="button"
              onClick={action.onClick}
              className="ml-1 shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors"
              style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}
            >
              {action.label}
            </button>
          )}
        </motion.div>
      </div>
    </div>
  );
}
