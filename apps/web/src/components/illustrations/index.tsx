import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Small, theme-aware spot illustrations (inline SVG, no assets). Colours come from the design
 * tokens, so they follow light/dark and the tenant accent.
 */
export type IllustrationName =
  | 'empty'
  | 'search'
  | 'people'
  | 'spaces'
  | 'inbox'
  | 'lock'
  | 'notfound'
  | 'error'
  | 'success'
  | 'chart'
  | 'calendar'
  | 'build';

const SOFT = 'var(--accent)';
const LINE = 'var(--muted-foreground)';
const MAIN = 'var(--primary)';
const CARD = 'var(--card)';

const stroke = { strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

function Frame({ children }: { children: ReactNode }) {
  return (
    <>
      <ellipse cx="60" cy="86" rx="34" ry="4" fill={LINE} opacity="0.12" />
      <circle cx="60" cy="46" r="36" fill={SOFT} />
      {children}
    </>
  );
}

const ART: Record<IllustrationName, ReactNode> = {
  empty: (
    <Frame>
      <path
        d="M36 52 46 36h28l10 16v20a4 4 0 0 1-4 4H40a4 4 0 0 1-4-4V52Z"
        fill={CARD}
        stroke={LINE}
        {...stroke}
      />
      <path d="M36 52h16a8 8 0 0 0 16 0h16" stroke={MAIN} {...stroke} />
      <path d="M60 24v6M48 27l3 5M72 27l-3 5" stroke={MAIN} {...stroke} opacity="0.6" />
    </Frame>
  ),
  search: (
    <Frame>
      <circle cx="54" cy="42" r="15" fill={CARD} stroke={LINE} {...stroke} />
      <path d="m65 53 14 14" stroke={MAIN} {...stroke} strokeWidth={3} />
      <path d="M48 42h12M48 47h7" stroke={LINE} {...stroke} opacity="0.6" />
    </Frame>
  ),
  people: (
    <Frame>
      <circle cx="46" cy="40" r="7" fill={CARD} stroke={LINE} {...stroke} />
      <path d="M34 64c0-7 5-12 12-12s12 5 12 12" fill={CARD} stroke={LINE} {...stroke} />
      <circle cx="73" cy="36" r="8" fill={CARD} stroke={MAIN} {...stroke} />
      <path d="M60 64c0-8 6-14 13-14s13 6 13 14" fill={CARD} stroke={MAIN} {...stroke} />
    </Frame>
  ),
  spaces: (
    <Frame>
      <rect x="34" y="30" width="22" height="22" rx="5" fill={CARD} stroke={LINE} {...stroke} />
      <rect x="64" y="30" width="22" height="22" rx="5" fill={CARD} stroke={MAIN} {...stroke} />
      <rect x="34" y="58" width="22" height="14" rx="5" fill={CARD} stroke={LINE} {...stroke} />
      <rect x="64" y="58" width="22" height="14" rx="5" fill={CARD} stroke={LINE} {...stroke} />
    </Frame>
  ),
  inbox: (
    <Frame>
      <path
        d="M34 54 42 34h36l8 20v16a4 4 0 0 1-4 4H38a4 4 0 0 1-4-4V54Z"
        fill={CARD}
        stroke={LINE}
        {...stroke}
      />
      <path d="M34 54h14l4 8h16l4-8h14" stroke={MAIN} {...stroke} />
    </Frame>
  ),
  lock: (
    <Frame>
      <rect x="40" y="46" width="40" height="28" rx="6" fill={CARD} stroke={LINE} {...stroke} />
      <path d="M48 46v-6a12 12 0 0 1 24 0v6" stroke={MAIN} {...stroke} />
      <circle cx="60" cy="58" r="3" fill={MAIN} />
      <path d="M60 61v5" stroke={MAIN} {...stroke} />
    </Frame>
  ),
  notfound: (
    <Frame>
      <rect x="32" y="32" width="56" height="38" rx="6" fill={CARD} stroke={LINE} {...stroke} />
      <path d="M32 42h56" stroke={LINE} {...stroke} />
      <circle cx="39" cy="37" r="1.5" fill={MAIN} />
      <circle cx="45" cy="37" r="1.5" fill={LINE} />
      <path d="M50 62c2-6 8-6 10 0M48 52h.01M72 52h.01" stroke={MAIN} {...stroke} />
    </Frame>
  ),
  error: (
    <Frame>
      <path d="M60 28 86 70H34L60 28Z" fill={CARD} stroke={LINE} {...stroke} />
      <path d="M60 44v12" stroke={MAIN} {...stroke} strokeWidth={3} />
      <circle cx="60" cy="63" r="1.8" fill={MAIN} />
    </Frame>
  ),
  success: (
    <Frame>
      <circle cx="60" cy="48" r="22" fill={CARD} stroke={LINE} {...stroke} />
      <path d="m49 49 8 8 15-17" stroke={MAIN} {...stroke} strokeWidth={3.5} />
    </Frame>
  ),
  chart: (
    <Frame>
      <rect x="32" y="30" width="56" height="42" rx="6" fill={CARD} stroke={LINE} {...stroke} />
      <path d="M42 62V52M54 62V44M66 62V50M78 62V38" stroke={MAIN} {...stroke} strokeWidth={4} />
    </Frame>
  ),
  calendar: (
    <Frame>
      <rect x="34" y="32" width="52" height="40" rx="6" fill={CARD} stroke={LINE} {...stroke} />
      <path d="M34 44h52M46 28v8M74 28v8" stroke={LINE} {...stroke} />
      <path d="M46 56h6M58 56h6M70 56h6M46 64h6M58 64h6" stroke={MAIN} {...stroke} />
    </Frame>
  ),
  build: (
    <Frame>
      <path
        d="m44 70 22-22M62 36a10 10 0 0 0 14 14l-3-3-6 1-1-6-4-6Z"
        fill={CARD}
        stroke={MAIN}
        {...stroke}
      />
      <path d="M36 70l8-2-6-6-2 8Z" fill={CARD} stroke={LINE} {...stroke} />
    </Frame>
  ),
};

export function Illustration({ name, className }: { name: IllustrationName; className?: string }) {
  return (
    <svg
      fill="none"
      viewBox="0 0 120 92"
      className={cn('h-24 w-auto', className)}
      aria-hidden
      focusable="false"
    >
      {ART[name]}
    </svg>
  );
}
