'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, Loader2 } from 'lucide-react';
import type { MessageDTO, PersonDTO } from '@crew-deck/shared';
import { Button } from '@/components/ui/button';
import type { ChannelView } from '@/lib/messaging-api';
import { buildRows, type Row } from '@/lib/messaging-logic';
import { cn } from '@/lib/utils';
import { PendingRow } from './message-row';
import type { PendingMessage } from './store';

const estimate = (r: Row | undefined) =>
  !r
    ? 48
    : r.kind === 'date'
      ? 40
      : r.kind === 'unread'
        ? 28
        : r.kind === 'start'
          ? 160
          : r.kind === 'msg' && r.grouped
            ? 26
            : 52;

export interface MessageListProps {
  selfId: string;
  /** Renders one message row (the caller owns the actions, so every list behaves alike). */
  renderMessage: (m: MessageDTO, grouped: boolean, highlighted: boolean) => ReactNode;
  channelId: string;
  view: ChannelView;
  self: PersonDTO;
  pending: PendingMessage[];
  /** The read cursor when the conversation was opened: drives the "New messages" divider. */
  initialLastReadSeq: number;
  focusSeq: number | null;
  /** Shown at the very top once the whole history is loaded. */
  intro: ReactNode;
  onLoadOlder: () => Promise<void>;
  onJumpLatest: () => void;
  onMarkRead: (seq: number) => void;
  onRetry: (clientMsgId: string) => void;
  onDiscard: (clientMsgId: string) => void;
}

export function MessageList(props: MessageListProps) {
  const { view, pending, selfId, self, channelId } = props;
  const parentRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(true);
  const [focused, setFocused] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [newBelow, setNewBelow] = useState(0);
  const [dividerAbove, setDividerAbove] = useState(false);
  const [highlight, setHighlight] = useState<number | null>(null);
  const anchor = useRef<{ key: string; delta: number } | null>(null);
  const placed = useRef<string | null>(null);
  const known = useRef(new Set<string>());
  const initialDone = useRef(false);

  const rows = useMemo(
    () =>
      buildRows(view.messages, pending, {
        selfId,
        lastReadSeq: props.initialLastReadSeq,
        showStart: !view.hasOlder,
      }),
    [view.messages, view.hasOlder, pending, selfId, props.initialLastReadSeq],
  );
  const dividerIndex = rows.findIndex((r) => r.kind === 'unread');

  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => estimate(rows[i]),
    overscan: 12,
    getItemKey: (i) => rows[i]?.key ?? i,
  });

  // Fresh conversation: forget scroll state.
  useEffect(() => {
    placed.current = null;
    known.current = new Set();
    initialDone.current = false;
    atBottomRef.current = true;
    setAtBottom(true);
    setNewBelow(0);
  }, [channelId]);

  const scrollToEnd = useCallback(() => {
    if (rows.length === 0) return;
    virt.scrollToIndex(rows.length - 1, { align: 'end' });
    // Rows are measured as they appear, so settle once more after layout.
    requestAnimationFrame(
      () => parentRef.current && (parentRef.current.scrollTop = parentRef.current.scrollHeight),
    );
  }, [rows.length, virt]);

  // First placement: a linked message, the first unread, or the bottom.
  useLayoutEffect(() => {
    if (placed.current === channelId || rows.length === 0 || !parentRef.current) return;
    placed.current = channelId;
    const focusIdx =
      props.focusSeq === null
        ? -1
        : rows.findIndex((r) => r.kind === 'msg' && r.m.seq === props.focusSeq);
    if (focusIdx >= 0) {
      virt.scrollToIndex(focusIdx, { align: 'center' });
      setHighlight(props.focusSeq);
      const t = setTimeout(() => setHighlight(null), 2500);
      atBottomRef.current = false;
      setAtBottom(false);
      return () => clearTimeout(t);
    }
    if (dividerIndex >= 0) {
      virt.scrollToIndex(dividerIndex, { align: 'start' });
      atBottomRef.current = false;
      setAtBottom(false);
    } else {
      scrollToEnd();
      setTimeout(scrollToEnd, 80);
    }
    for (const r of rows) known.current.add(r.key);
    initialDone.current = true;
  }, [channelId, rows.length > 0]);

  // Keep position when older messages are prepended; follow the end when new ones arrive.
  const lastKey = rows.at(-1)?.key;
  const prevLast = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    if (anchor.current) {
      const idx = rows.findIndex((r) => r.key === anchor.current!.key);
      if (idx >= 0) {
        const off = virt.getOffsetForIndex(idx, 'start');
        if (off) el.scrollTop = off[0] - anchor.current.delta;
      }
      anchor.current = null;
      return;
    }
    if (prevLast.current !== undefined && lastKey !== prevLast.current && initialDone.current) {
      const last = rows.at(-1);
      const mine = last?.kind === 'pending' || (last?.kind === 'msg' && last.m.authorId === selfId);
      if (atBottomRef.current || mine) scrollToEnd();
      else if (last?.kind === 'msg') setNewBelow((n) => n + 1);
    }
    prevLast.current = lastKey;
  }, [lastKey, rows.length]);

  useEffect(() => {
    for (const r of rows) known.current.add(r.key);
  });

  const onScroll = useCallback(() => {
    const el = parentRef.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 64 && !view.hasNewer;
    if (bottom !== atBottomRef.current) {
      atBottomRef.current = bottom;
      setAtBottom(bottom);
      if (bottom) setNewBelow(0);
    }
    const first = virt.range?.startIndex ?? 0;
    setDividerAbove(dividerIndex >= 0 && first > dividerIndex);
    if (el.scrollTop < 160 && view.hasOlder && !loadingOlder) {
      const items = virt.getVirtualItems();
      const top = items[0];
      const row = top && rows[top.index];
      if (row) anchor.current = { key: row.key, delta: top.start - el.scrollTop };
      setLoadingOlder(true);
      void props.onLoadOlder().finally(() => setLoadingOlder(false));
    }
  }, [virt, view.hasNewer, view.hasOlder, loadingOlder, rows, dividerIndex, props]);

  // The cursor only moves while the window is focused and the bottom is in view.
  useEffect(() => {
    const on = () => setFocused(document.hasFocus() && !document.hidden);
    on();
    window.addEventListener('focus', on);
    window.addEventListener('blur', on);
    document.addEventListener('visibilitychange', on);
    return () => {
      window.removeEventListener('focus', on);
      window.removeEventListener('blur', on);
      document.removeEventListener('visibilitychange', on);
    };
  }, []);
  const newest = view.hasNewer ? 0 : view.lastSeq;
  useEffect(() => {
    if (atBottom && focused && newest > 0) props.onMarkRead(newest);
  }, [atBottom, focused, newest, channelId]);

  const jumpToUnread = () =>
    dividerIndex >= 0 && virt.scrollToIndex(dividerIndex, { align: 'start', behavior: 'smooth' });

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={parentRef}
        onScroll={onScroll}
        role="log"
        aria-label="Messages"
        aria-live="off"
        tabIndex={0}
        className="focus-visible:ring-ring/40 h-full overflow-y-auto overscroll-contain py-2 outline-none focus-visible:ring-2 focus-visible:ring-inset"
      >
        {loadingOlder && (
          <div
            className="text-muted-foreground flex items-center justify-center gap-2 py-2 text-xs"
            role="status"
          >
            <Loader2 className="size-3.5 animate-spin" /> Loading earlier messages
          </div>
        )}
        <div style={{ height: virt.getTotalSize(), position: 'relative', width: '100%' }}>
          {virt.getVirtualItems().map((v) => {
            const r = rows[v.index];
            if (!r) return null;
            const fresh = initialDone.current && !known.current.has(r.key) && r.kind === 'msg';
            return (
              <div
                key={v.key}
                data-index={v.index}
                ref={virt.measureElement}
                className={cn(
                  'absolute top-0 left-0 w-full',
                  fresh && 'animate-in fade-in slide-in-from-bottom-1 duration-200',
                )}
                style={{ transform: `translateY(${v.start}px)` }}
              >
                {r.kind === 'start' ? (
                  <div className="px-4 pt-4 pb-3">{props.intro}</div>
                ) : r.kind === 'date' ? (
                  <div
                    className="flex items-center gap-3 px-4 py-3"
                    role="separator"
                    aria-label={r.label}
                  >
                    <span className="bg-border h-px flex-1" />
                    <span className="bg-background text-muted-foreground rounded-full border px-3 py-0.5 text-xs font-medium">
                      {r.label}
                    </span>
                    <span className="bg-border h-px flex-1" />
                  </div>
                ) : r.kind === 'unread' ? (
                  <div
                    className="text-destructive flex items-center gap-3 px-4 py-1"
                    role="separator"
                    aria-label="New messages"
                  >
                    <span className="bg-destructive/40 h-px flex-1" />
                    <span className="text-xs font-semibold tracking-wide uppercase">
                      New messages
                    </span>
                    <span className="bg-destructive/40 h-px flex-1" />
                  </div>
                ) : r.kind === 'msg' ? (
                  props.renderMessage(r.m, r.grouped, highlight === r.m.seq)
                ) : (
                  <PendingRow
                    pending={r.p}
                    self={self}
                    grouped={r.grouped}
                    onRetry={() => props.onRetry(r.p.clientMsgId)}
                    onDiscard={() => props.onDiscard(r.p.clientMsgId)}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
      {dividerAbove && dividerIndex >= 0 && (
        <Button
          size="sm"
          variant="secondary"
          className="absolute top-2 left-1/2 -translate-x-1/2 rounded-full shadow-md"
          onClick={jumpToUnread}
        >
          <ArrowUp /> Jump to unread
        </Button>
      )}
      {!atBottom && (
        <Button
          size="sm"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full shadow-md"
          onClick={() => {
            if (view.hasNewer) props.onJumpLatest();
            else scrollToEnd();
          }}
        >
          <ArrowDown />{' '}
          {newBelow > 0 ? `${newBelow} new message${newBelow === 1 ? '' : 's'}` : 'Jump to latest'}
        </Button>
      )}
    </div>
  );
}
