'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  CalendarDays,
  FileText,
  Hash,
  Link2,
  MessageSquare,
  Search,
  User,
  X,
} from 'lucide-react';
import type { SearchHit } from '@crew-deck/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/shared/empty-state';
import { LoadError } from '@/components/shared/load-error';
import { PersonAvatar } from '@/components/messages/person-avatar';
import { formatSize } from '@/components/messages/message-parts';
import {
  conversationName,
  personName,
  useChannels,
  useFileSearch,
  useMessageSearch,
  usePeople,
} from '@/lib/messaging-api';
import { useMe } from '@/components/shell/me-context';
import { setToken, toggleToken } from '@/lib/search-tokens';
import { cn } from '@/lib/utils';

const hrefOf = (h: SearchHit) =>
  `/messages/${h.channel.id}?m=${h.message.seq}${h.message.threadRootId && !h.message.alsoInChannel ? `&thread=${h.message.threadRootId}` : ''}`;

function Snippet({ parts }: { parts: SearchHit['snippet'] }) {
  return (
    <p className="text-[14px] leading-snug break-words">
      {parts.map((p, i) =>
        p.match ? (
          <mark
            key={i}
            className="bg-amber-200/80 text-foreground rounded px-0.5 dark:bg-amber-400/30"
          >
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </p>
  );
}

function Chip({
  active,
  className,
  ...props
}: React.ComponentProps<'button'> & { active?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        'focus-visible:ring-ring/50 inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[13px] outline-none focus-visible:ring-[3px]',
        active ? 'border-primary/50 bg-primary/10 text-primary' : 'hover:bg-muted',
        className,
      )}
      {...props}
    />
  );
}

function PickPerson({ onPick }: { onPick: (token: string) => void }) {
  const [q, setQ] = useState('');
  const people = usePeople(q.trim());
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Chip>
          <User className="size-3.5" aria-hidden /> From
        </Chip>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="start">
        <Input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find a person"
          aria-label="Find a person"
          className="mb-2 h-8"
        />
        <ul className="max-h-56 overflow-y-auto">
          {(people.data ?? []).slice(0, 8).map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => onPick(`from:${(m.email.split('@')[0] ?? m.id).toLowerCase()}`)}
                className="hover:bg-muted flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm"
              >
                <PersonAvatar person={m} size="sm" presence={false} /> {m.name ?? m.email}
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function PickChannel({ onPick }: { onPick: (token: string) => void }) {
  const channels = useChannels().data ?? [];
  const rooms = channels.filter((c) => c.type === 'public' || c.type === 'private');
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Chip>
          <Hash className="size-3.5" aria-hidden /> In
        </Chip>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="start">
        <ul className="max-h-64 overflow-y-auto" aria-label="Channels">
          {rooms.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onPick(`in:#${c.name}`)}
                className="hover:bg-muted flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm"
              >
                <Hash className="text-muted-foreground size-3.5" aria-hidden /> {c.name}
              </button>
            </li>
          ))}
          {rooms.length === 0 && (
            <li className="text-muted-foreground px-2 py-1.5 text-sm">No channels yet</li>
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function PickDates({ q, onChange }: { q: string; onChange: (q: string) => void }) {
  const get = (key: string) => q.match(new RegExp(`${key}:(\\d{4}-\\d{2}-\\d{2})`))?.[1] ?? '';
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Chip active={!!get('after') || !!get('before')}>
          <CalendarDays className="size-3.5" aria-hidden /> Date
        </Chip>
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-2 p-3" align="start">
        <label className="flex items-center justify-between gap-2 text-sm">
          After
          <Input
            type="date"
            value={get('after')}
            onChange={(e) => onChange(setToken(q, 'after', e.target.value || null))}
            className="h-8 w-40"
          />
        </label>
        <label className="flex items-center justify-between gap-2 text-sm">
          Before
          <Input
            type="date"
            value={get('before')}
            onChange={(e) => onChange(setToken(q, 'before', e.target.value || null))}
            className="h-8 w-40"
          />
        </label>
      </PopoverContent>
    </Popover>
  );
}

function SearchView() {
  const router = useRouter();
  const me = useMe().user;
  const params = useSearchParams();
  const urlQ = params.get('q') ?? '';
  const [input, setInput] = useState(urlQ);
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<'messages' | 'files'>('messages');
  useEffect(() => {
    setInput(urlQ);
    setPage(1);
  }, [urlQ]);
  const go = (q: string) =>
    router.replace(`/messages/search${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`);

  const results = useMessageSearch(urlQ, page);
  // Earlier pages stay visible while the next one loads.
  const [shown, setShown] = useState<SearchHit[]>([]);
  useEffect(() => {
    if (!results.data) return;
    setShown((cur) =>
      results.data.page === 1
        ? results.data.hits
        : [
            ...cur,
            ...results.data.hits.filter((h) => !cur.some((c) => c.message.id === h.message.id)),
          ],
    );
  }, [results.data]);
  const files = useFileSearch(
    urlQ.replace(/\b(from|in|before|after|has|is):\S+/gi, '').trim(),
    tab === 'files',
  );
  const channels = useChannels().data ?? [];
  const nameOf = (c: SearchHit['channel']) =>
    c.type === 'public' || c.type === 'private'
      ? `#${c.name}`
      : conversationName(
          channels.find((x) => x.id === c.id) ?? { type: c.type, name: c.name },
          me.id,
        );
  const hasToken = (t: string) => urlQ.split(/\s+/).includes(t);
  const tips = useMemo(
    () => ['from:ann', 'in:#general', 'has:file', 'has:link', 'is:thread', 'after:2026-01-01'],
    [],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-col gap-2 border-b p-3 sm:p-4">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            go(input);
          }}
        >
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="md:hidden"
            aria-label="Back to conversations"
            onClick={() => router.push('/messages')}
          >
            <ArrowLeft />
          </Button>
          <div className="relative flex-1">
            <Search
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
              aria-hidden
            />
            <Input
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Search messages and files"
              aria-label="Search messages"
              className="pr-8 pl-8"
            />
            {input && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  setInput('');
                  go('');
                }}
                className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
          <Button type="submit">Search</Button>
        </form>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filters">
          <PickPerson onPick={(t) => go(`${urlQ} ${t}`.trim())} />
          <PickChannel onPick={(t) => go(`${urlQ} ${t}`.trim())} />
          <PickDates q={urlQ} onChange={go} />
          <Chip active={hasToken('has:file')} onClick={() => go(toggleToken(urlQ, 'has:file'))}>
            <FileText className="size-3.5" aria-hidden /> Has file
          </Chip>
          <Chip active={hasToken('has:link')} onClick={() => go(toggleToken(urlQ, 'has:link'))}>
            <Link2 className="size-3.5" aria-hidden /> Has link
          </Chip>
          <Chip active={hasToken('is:thread')} onClick={() => go(toggleToken(urlQ, 'is:thread'))}>
            <MessageSquare className="size-3.5" aria-hidden /> In threads
          </Chip>
        </div>
        <Tabs value={tab} onValueChange={(v) => setTab(v as 'messages' | 'files')}>
          <TabsList aria-label="Result type" className="h-8">
            <TabsTrigger value="messages">Messages</TabsTrigger>
            <TabsTrigger value="files">Files</TabsTrigger>
          </TabsList>
        </Tabs>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!urlQ.trim() ? (
          <div className="flex h-full items-center justify-center p-6">
            <EmptyState
              icon={Search}
              title="Search everything you can see"
              description={`Type some words, or narrow it down with ${tips.join(', ')}.`}
            />
          </div>
        ) : tab === 'files' ? (
          files.isLoading ? (
            <p className="text-muted-foreground p-6 text-sm">Searching files…</p>
          ) : files.isError ? (
            <LoadError what="the files" onRetry={() => void files.refetch()} />
          ) : !files.data?.length ? (
            <div className="p-6">
              <EmptyState
                icon={FileText}
                title="No files match"
                description="Files are found by their name. Try a different word."
              />
            </div>
          ) : (
            <ul className="divide-y">
              {files.data.map((f) => (
                <li key={f.id} className="flex items-center gap-3 px-4 py-3">
                  <FileText className="text-muted-foreground size-6 shrink-0" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <a
                      href={f.url}
                      download={f.name}
                      className="block truncate text-sm font-medium hover:underline"
                    >
                      {f.name}
                    </a>
                    <p className="text-muted-foreground text-xs">
                      {formatSize(f.size)} · {nameOf(f.channel)} ·{' '}
                      {new Date(f.createdAt).toLocaleDateString([], {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </p>
                  </div>
                  {f.seq !== null && (
                    <Link
                      href={`/messages/${f.channel.id}?m=${f.seq}`}
                      className="text-primary text-xs hover:underline"
                    >
                      Show in conversation
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )
        ) : results.isLoading && shown.length === 0 ? (
          <div className="space-y-4 p-4" aria-hidden>
            {[70, 50, 80].map((w) => (
              <div key={w} className="space-y-2">
                <div className="bg-muted h-3 w-40 animate-pulse rounded" />
                <div className="bg-muted h-3 animate-pulse rounded" style={{ width: `${w}%` }} />
              </div>
            ))}
          </div>
        ) : results.isError ? (
          <LoadError what="the search results" onRetry={() => void results.refetch()} />
        ) : results.data?.unresolved.length ? (
          <div className="p-6">
            <EmptyState
              icon={Search}
              title="That filter does not match anything"
              description={`Nobody or no channel you can search matches ${results.data.unresolved.join(', ')}. Check the spelling, or remove the filter.`}
            />
          </div>
        ) : shown.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={Search}
              title={`Nothing found for “${urlQ}”`}
              description="Try fewer or different words. Search covers conversations you are in and public channels."
            />
          </div>
        ) : (
          <>
            <p className="text-muted-foreground px-4 pt-3 text-xs" aria-live="polite">
              {shown.length}
              {results.data?.hasMore ? '+' : ''} result{shown.length === 1 ? '' : 's'}
            </p>
            <ol className="divide-y">
              {shown.map((h) => (
                <li key={h.message.id}>
                  <Link
                    href={hrefOf(h)}
                    className="hover:bg-muted/50 focus-visible:ring-ring/50 flex gap-3 px-4 py-3 outline-none focus-visible:ring-[3px] focus-visible:ring-inset"
                  >
                    <PersonAvatar person={h.message.author} presence={false} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline gap-x-2 text-xs">
                        <span className="text-foreground text-sm font-semibold">
                          {personName(h.message.author)}
                        </span>
                        <span className="text-muted-foreground">{nameOf(h.channel)}</span>
                        {h.message.threadRootId && (
                          <span className="text-muted-foreground">in a thread</span>
                        )}
                        <time dateTime={h.message.createdAt} className="text-muted-foreground">
                          {new Date(h.message.createdAt).toLocaleDateString([], {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </time>
                      </span>
                      <Snippet
                        parts={
                          h.snippet.length
                            ? h.snippet
                            : [{ text: h.message.bodyText ?? '', match: false }]
                        }
                      />
                      {h.message.attachments.length > 0 && (
                        <span className="text-muted-foreground mt-1 flex items-center gap-1 text-xs">
                          <FileText className="size-3" aria-hidden />{' '}
                          {h.message.attachments.map((a) => a.name).join(', ')}
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
            {results.data?.hasMore && (
              <div className="p-4 text-center">
                <Button
                  variant="outline"
                  loading={results.isFetching}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Show more results
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={null}>
      <SearchView />
    </Suspense>
  );
}
