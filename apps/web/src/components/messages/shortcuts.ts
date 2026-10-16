'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { conversationName, useChannels } from '@/lib/messaging-api';
import { useMe } from '@/components/shell/me-context';
import { usePanel } from './panel';
import { useRealtime } from './realtime';

/**
 * Keyboard shortcuts for the Messages area:
 * - Alt+Shift+Down / Up: the next / previous conversation with unread messages
 * - Esc (with no panel, menu or dialog open): mark the open conversation as read
 * Ctrl/Cmd+K is the quick switcher in the top bar's search palette.
 */
export function useMessagesShortcuts(activeId: string | null) {
  const router = useRouter();
  const me = useMe().user.id;
  const rt = useRealtime();
  const panel = usePanel();
  const channels = useChannels().data;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.shiftKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        const unread = [...(channels ?? [])]
          .filter((c) => c.unread > 0 || c.mentionCount > 0)
          .sort((a, b) => conversationName(a, me).localeCompare(conversationName(b, me)));
        if (unread.length === 0) return;
        e.preventDefault();
        const at = unread.findIndex((c) => c.id === activeId);
        const step = e.key === 'ArrowDown' ? 1 : -1;
        const next = unread[(at + step + unread.length) % unread.length]!;
        router.push(`/messages/${next.id}`);
        return;
      }
      if (e.key === 'Escape' && !e.defaultPrevented && activeId && !panel.open && !panel.thread) {
        if (document.querySelector('[role=dialog],[role=menu],[role=listbox],[data-state=open]'))
          return;
        const c = channels?.find((x) => x.id === activeId);
        if (c && (c.unread > 0 || c.mentionCount > 0)) rt.markRead(activeId, c.lastSeq);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeId, channels, me, panel.open, panel.thread, router, rt]);
}
