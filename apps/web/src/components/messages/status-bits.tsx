'use client';

import { useEffect, useState } from 'react';
import { CloudOff, Loader2 } from 'lucide-react';
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
  return (
    <div
      className="text-muted-foreground flex h-5 items-center gap-1.5 px-4 text-xs"
      aria-live="polite"
      role="status"
    >
      {text && (
        <>
          <span className="flex gap-0.5" aria-hidden>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="bg-muted-foreground/70 size-1 animate-bounce rounded-full"
                style={{ animationDelay: `${i * 120}ms` }}
              />
            ))}
          </span>
          <span>{text}…</span>
        </>
      )}
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
    <div className="space-y-5 px-4 py-4" aria-hidden>
      {[72, 40, 88, 56, 64].map((w, i) => (
        <div key={i} className="flex gap-3">
          <div className="bg-muted size-8 shrink-0 animate-pulse rounded-full" />
          <div className="flex-1 space-y-2">
            <div className="bg-muted h-3 w-32 animate-pulse rounded" />
            <div className="bg-muted h-3 animate-pulse rounded" style={{ width: `${w}%` }} />
            {i % 2 === 0 && <div className="bg-muted h-3 w-1/3 animate-pulse rounded" />}
          </div>
        </div>
      ))}
    </div>
  );
}
