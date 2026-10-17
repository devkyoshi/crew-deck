'use client';

import { useEffect, useState } from 'react';
import { CloudOff, Loader2 } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Skeleton } from '@/components/ui/skeleton';
import { useMessaging } from './store';
import { personName, type PersonDTO } from '@/lib/messaging-api';

/** "Ann is typing…", up to three names. Signals expire after five seconds on their own. */
export function TypingIndicator({
  channelId,
  selfId,
  people,
}: {
  channelId: string;
  selfId: string;
  people: Map<string, PersonDTO>;
}) {
  const room = useMessaging((s) => s.typing[channelId]);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const now = Date.now();
  const ids = Object.entries(room ?? {})
    .filter(([id, until]) => until > now && id !== selfId)
    .map(([id]) => id)
    .slice(0, 3);
  const names = ids.map((id) => personName(people.get(id)).split(' ')[0]);
  const text =
    names.length === 0
      ? ''
      : names.length === 1
        ? `${names[0]} is typing`
        : names.length === 2
          ? `${names[0]} and ${names[1]} are typing`
          : `${names[0]}, ${names[1]} and ${names[2]} are typing`;
  const reduce = useReducedMotion();
  return (
    <div
      className="text-muted-foreground flex h-6 items-center px-4 text-xs sm:px-5"
      aria-live="polite"
      role="status"
    >
      <AnimatePresence mode="wait" initial={false}>
        {text && (
          <motion.div
            key={names.length}
            className="flex items-center gap-1.5"
            initial={reduce ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: 4 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            <span
              className="bg-muted flex items-center gap-0.5 rounded-full px-1.5 py-1"
              aria-hidden
            >
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="bg-muted-foreground/70 size-1 rounded-full"
                  animate={reduce ? undefined : { y: [0, -3, 0], opacity: [0.5, 1, 0.5] }}
                  transition={{
                    duration: 0.9,
                    repeat: Infinity,
                    delay: i * 0.15,
                    ease: 'easeInOut',
                  }}
                />
              ))}
            </span>
            <span>{text}…</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** A quiet banner while the connection is down. Sending still works: messages go through the API. */
export function ConnectionBanner() {
  const status = useMessaging((s) => s.status);
  const [visible, setVisible] = useState(false);
  // Brief blips are not worth announcing.
  useEffect(() => {
    if (status === 'connected' || status === 'connecting') return setVisible(false);
    const t = setTimeout(() => setVisible(true), 1500);
    return () => clearTimeout(t);
  }, [status]);
  if (!visible) return null;
  return (
    <div
      role="status"
      className="bg-muted text-muted-foreground flex items-center justify-center gap-2 border-b px-3 py-1 text-xs"
    >
      {status === 'offline' ? (
        <CloudOff className="size-3.5" aria-hidden />
      ) : (
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
      )}
      {status === 'offline'
        ? 'You are offline. Messages will send when you are back.'
        : 'Reconnecting… new messages will appear when we are back.'}
    </div>
  );
}

/** Skeletons shaped like messages, so the layout does not jump when history arrives. */
export function MessageSkeletons() {
  return (
    <div className="space-y-6 px-4 py-4 sm:px-5" aria-hidden>
      {[72, 40, 88, 56, 64].map((w, i) => (
        <div key={i} className="flex gap-3" style={{ opacity: 1 - i * 0.12 }}>
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 rounded-sm" style={{ width: `${6 + ((i * 5) % 9)}rem` }} />
            <Skeleton className="h-3 rounded-sm" style={{ width: `${w}%` }} />
            {i % 2 === 0 && <Skeleton className="h-3 w-1/3 rounded-sm" />}
          </div>
        </div>
      ))}
    </div>
  );
}
