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

/** Whether the right-hand details panel is open. Remembered per browser. */
interface PanelState {
  open: boolean;
  toggle: () => void;
  setOpen: (v: boolean) => void;
}

const Ctx = createContext<PanelState>({ open: false, toggle: () => {}, setOpen: () => {} });
export const usePanel = () => useContext(Ctx);

const KEY = 'messages:details-open';

export function PanelProvider({ children }: { children: ReactNode }) {
  // Closed on the server and on first paint. The saved choice is applied right after hydration, and
  // only on wide screens: on a phone the panel is a sheet over the conversation and always starts closed.
  const [open, setOpenState] = useState(false);
  useEffect(() => {
    try {
      if (window.matchMedia('(min-width: 1024px)').matches) setOpenState(localStorage.getItem(KEY) === '1');
    } catch {
      /* storage unavailable */
    }
  }, []);
  const setOpen = useCallback((v: boolean) => {
    setOpenState(v);
    try {
      if (window.matchMedia('(min-width: 1024px)').matches) localStorage.setItem(KEY, v ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
  }, []);
  const value = useMemo(() => ({ open, setOpen, toggle: () => setOpen(!open) }), [open, setOpen]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
