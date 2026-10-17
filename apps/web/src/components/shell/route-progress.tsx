'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

/**
 * A thin accent bar under the top of the window that runs while a page is loading. It starts when an
 * in-app link is clicked and completes when the path changes, so slow navigations never feel frozen.
 */
export function RouteProgress() {
  const pathname = usePathname();
  const [state, setState] = useState<{ pct: number; visible: boolean }>({ pct: 0, visible: false });
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const tick = useRef<ReturnType<typeof setInterval>>(undefined);

  const clear = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    clearInterval(tick.current);
  };

  // Start on a click that goes to another path in this app.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement).closest?.('a');
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      clear();
      setState({ pct: 12, visible: true });
      // Creeps toward 90% and never quite arrives until the new page does.
      tick.current = setInterval(
        () => setState((s) => ({ ...s, pct: s.pct + (90 - s.pct) * 0.12 })),
        200,
      );
    };
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('click', onClick);
      clear();
    };
  }, []);

  // Finish when the path changes.
  useEffect(() => {
    clear();
    setState((s) => {
      if (!s.visible) return s;
      timers.current.push(
        setTimeout(() => setState({ pct: 100, visible: false }), 120),
        setTimeout(() => setState({ pct: 0, visible: false }), 520),
      );
      return { pct: 100, visible: true };
    });
  }, [pathname]);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5"
      style={{ opacity: state.visible ? 1 : 0, transition: 'opacity 300ms' }}
    >
      <div
        className="bg-primary h-full rounded-r-full shadow-[0_0_8px_var(--primary)]"
        style={{
          width: `${state.pct}%`,
          transition: state.pct === 0 ? 'none' : 'width 250ms var(--ease-out-quint)',
        }}
      />
    </div>
  );
}
