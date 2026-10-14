'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { Me } from '@/lib/api';

const MeContext = createContext<Me | null>(null);

export function MeProvider({ me, children }: { me: Me; children: ReactNode }) {
  return <MeContext.Provider value={me}>{children}</MeContext.Provider>;
}

export function useMe() {
  const me = useContext(MeContext);
  if (!me) throw new Error('useMe must be used inside <MeProvider>');
  return me;
}

/** The signed-in person, or null outside the signed-in app (for example the /design showcase). */
export function useMaybeMe() {
  return useContext(MeContext);
}

/** UI mirror of the server's can(). The API still enforces every action. */
export function useIsAdmin() {
  return useMe().permissions.includes('group.manage');
}

export const initials = (name: string | null | undefined, fallback: string) =>
  (name || fallback)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
