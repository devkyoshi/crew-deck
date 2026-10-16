'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/**
 * The right-hand panel of the Messages area: either the channel's details or one thread. The choice
 * of "details open" is remembered per browser (wide screens only); a thread is never remembered.
 */
export interface OpenThread {
  channelId: string;
  rootId: string;
}

interface PanelState {
  /** Details are open. */
  open: boolean;
  toggle: () => void;
  setOpen: (v: boolean) => void;
  /** The thread being shown instead of the details, if any. */
  thread: OpenThread | null;
  openThread: (channelId: string, rootId: string) => void;
  closeThread: () => void;
}

const noop = () => {};
const Ctx = createContext<PanelState>({
  open: false,
  toggle: noop,
  setOpen: noop,
  thread: null,
  openThread: noop,
  closeThread: noop,
});
export const usePanel = () => useContext(Ctx);

const KEY = 'messages:details-open';
const wide = () => window.matchMedia('(min-width: 1024px)').matches;

export function PanelProvider({ children }: { children: ReactNode }) {
  // Closed on the server and on first paint. The saved choice is applied right after hydration, and
  // only on wide screens: on a phone the panel is a sheet over the conversation and always starts closed.
  const [open, setOpenState] = useState(false);
  const [thread, setThread] = useState<OpenThread | null>(null);
  useEffect(() => {
    try {
      if (wide()) setOpenState(localStorage.getItem(KEY) === '1');
    } catch {
      /* storage unavailable */
    }
  }, []);
  const setOpen = useCallback((v: boolean) => {
    setOpenState(v);
    if (v) setThread(null);
    try {
      if (wide()) localStorage.setItem(KEY, v ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
  }, []);
  const openThread = useCallback((channelId: string, rootId: string) => {
    setThread({ channelId, rootId });
    setOpenState(false);
  }, []);
  const closeThread = useCallback(() => setThread(null), []);
  const value = useMemo(
    () => ({
      open,
      setOpen,
      toggle: () => setOpen(!open),
      thread,
      openThread,
      closeThread,
    }),
    [open, setOpen, thread, openThread, closeThread],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
