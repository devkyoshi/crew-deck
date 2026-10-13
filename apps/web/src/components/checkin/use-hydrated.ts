'use client';

import { useSyncExternalStore } from 'react';

const noopSubscribe = () => () => {};

/**
 * False during server rendering and during the browser's hydration pass, true afterwards. Used so the
 * first client render matches the server HTML even when shared client-side data (for example a React
 * Query cache filled by a component that hydrated earlier) is already available.
 */
export function useHydrated() {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}
