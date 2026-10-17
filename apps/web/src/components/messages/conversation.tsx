'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Archive,
  Hash,
  Info,
  Lock,
  Megaphone,
  MessageSquarePlus,
  Upload,
  Users,
  Boxes,
  X,
} from 'lucide-react';
import { toast } from '@/lib/toast';
import type { AttachmentDTO, MessageDTO, PersonDTO } from '@crew-deck/shared';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/shared/empty-state';
import { LoadError } from '@/components/shared/load-error';
import { useHydrated } from '@/components/checkin/use-hydrated';
import { useIsAdmin, useMe } from '@/components/shell/me-context';
import { ApiError, api } from '@/lib/api';
import {
  channelPerms,
  conversationName,
  executeCommand,
  fetchView,
  useCommands,
  keys,
  loadOlder,
  personName,
  useChannel,
  useJoinChannel,
  useMembers,
  useMessages,
  type ChannelView,
} from '@/lib/messaging-api';
import type { CommandResult, ItemCardDTO } from '@crew-deck/shared';
import { FilesView, PinsView } from './channel-tabs';
import { CreateWorkDialog, useCreatableSpaces } from './create-work-dialog';
import { ItemCardView } from './item-card';
import { Composer, type ComposerHandle } from './composer';
import { useMessageActions } from './message-actions';
import { MessageList } from './message-list';
import { MessageRow } from './message-row';
import { ImageLightbox } from './message-parts';
import { usePanel } from './panel';
import { PersonAvatar } from './person-avatar';
import { ProfilePopover } from './profile-popover';
import { useRealtime } from './realtime';
import { ConnectionBanner, MessageSkeletons, TypingIndicator } from './status-bits';
import { useMessaging, usePendingFor } from './store';

function Intro({
  name,
  kind,
  topic,
  limited = false,
}: {
  name: string;
  kind: 'channel' | 'dm' | 'private';
  topic: string | null;
  /** Older messages are hidden by the plan's history window. */
  limited?: boolean;
}) {
  if (limited) {
    return (
      <div className="bg-muted/50 space-y-1 rounded-lg border border-dashed p-4">
        <h2 className="text-base font-semibold">Older messages are hidden</h2>
        <p className="text-muted-foreground text-sm">
          Your plan shows a limited history. Older messages are kept, and show again if the plan
          includes more history.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <h2 className="text-xl font-bold">
        {kind === 'dm'
          ? `This is the start of your conversation with ${name}`
          : `Welcome to ${kind === 'private' ? '🔒 ' : '#'}${name}`}
      </h2>
      <p className="text-muted-foreground text-sm">
        {kind === 'dm'
          ? 'Messages here are only visible to the people in this conversation.'
          : topic
            ? topic
            : 'This is the very beginning of the channel.'}
      </p>
    </div>
  );
}

/** Announces new messages from other people to screen readers, without moving focus. */
function LiveAnnouncer({ messages, selfId }: { messages: MessageDTO[]; selfId: string }) {
  const [text, setText] = useState('');
  const seen = useRef<string | null>(null);
  useEffect(() => {
    const last = messages.at(-1);
    if (!last) return;
    if (
      seen.current !== null &&
      seen.current !== last.id &&
      last.authorId !== selfId &&
      last.kind === 'user'
    ) {
      setText(`${personName(last.author)}: ${last.bodyText ?? ''}`);
    }
    seen.current = last.id;
  }, [messages, selfId]);
  return (
    <div className="sr-only" aria-live="polite" aria-atomic="true">
      {text}
    </div>
  );
}

type Tab = 'messages' | 'pins' | 'files';

/** `/task mine` → { name: 'task', args: 'mine' }, but only for commands the workspace offers. */
function parseCommand(text: string, commands: { name: string }[] | undefined) {
  const m = /^\/([a-z]+)(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!m || !commands?.some((c) => c.name === m[1]!.toLowerCase())) return null;
  return { name: m[1]!.toLowerCase(), args: (m[2] ?? '').trim() };
}

interface Ephemeral {
  id: number;
  text: string;
  cards: ItemCardDTO[];
}

export function Conversation({
  channelId,
  docked = false,
  onClose,
}: {
  channelId: string;
  /** Docked only: closes the panel. */
  onClose?: () => void;
  /** Shown beside a board rather than in the Messages area: no back arrow or details button. */
  docked?: boolean;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const qc = useQueryClient();
  const meUser = useMe().user;
  const isAdmin = useIsAdmin();
  const rt = useRealtime();
  const panel = usePanel();
  const hydrated = useHydrated();
  const { channel, isMember, isLoading, error } = useChannel(channelId);
  const messages = useMessages(channelId);
  const pending = usePendingFor(channelId);
  const members = useMembers(channelId, !!channel);
  const join = useJoinChannel();
  const composer = useRef<ComposerHandle>(null);
  const commands = useCommands();
  const creatable = useCreatableSpaces().spaces;
  const [ephemeral, setEphemeral] = useState<Ephemeral[]>([]);
  const [createTitle, setCreateTitle] = useState<string | null>(null);
  const ephemeralId = useRef(0);
  const [tab, setTab] = useState<Tab>('messages');
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const [lightbox, setLightbox] = useState<{ images: AttachmentDTO[]; index: number } | null>(null);

  const focusSeq = Number(search.get('m')) || null;

  // A link to a thread reply (from Threads, a notification or search) opens that thread's panel.
  const threadParam = search.get('thread');
  const { openThread } = panel;
  useEffect(() => {
    if (threadParam) openThread(channelId, threadParam);
  }, [channelId, threadParam, openThread]);

  // Where "New messages" starts: the cursor as it was when this conversation was opened.
  const initialRead = useRef<{ id: string; seq: number } | null>(null);
  if (channel && initialRead.current?.id !== channelId && channel.lastReadSeq !== undefined) {
    initialRead.current = { id: channelId, seq: channel.lastReadSeq };
  }
  const initialLastReadSeq =
    initialRead.current?.id === channelId ? initialRead.current.seq : Number.MAX_SAFE_INTEGER;

  // Tell the store which conversation is open, so its messages do not count as unread.
  useEffect(() => {
    useMessaging.getState().setActive(channelId);
    return () => useMessaging.getState().setActive(null);
  }, [channelId]);

  // A message link loads the window around it.
  useEffect(() => {
    if (!focusSeq) return;
    setTab('messages');
    void fetchView(channelId, { around: focusSeq }).then((v) =>
      qc.setQueryData(keys.messages(channelId), v),
    );
  }, [channelId, focusSeq, qc]);

  const people = useMemo(() => {
    const map = new Map<string, PersonDTO>();
    for (const m of members.data ?? []) if (m.person) map.set(m.userId, m.person);
    for (const m of messages.data?.messages ?? []) if (m.author) map.set(m.author.id, m.author);
    return map;
  }, [members.data, messages.data]);

  const self: PersonDTO = {
    id: meUser.id,
    name: meUser.name,
    email: meUser.email,
    avatarUrl: meUser.avatarUrl,
  };

  const perms = channelPerms(
    channel
      ? { ...channel, role: channel.role }
      : { type: 'public', isArchived: false, isAnnouncement: false },
    isAdmin,
  );
  const actions = useMessageActions({
    channelId,
    perms: channel ? perms : { ...perms, member: false },
    people,
  });

  const onLoadOlder = useCallback(() => loadOlder(qc, channelId), [qc, channelId]);
  const jumpLatest = useCallback(async () => {
    qc.setQueryData(keys.messages(channelId), await fetchView(channelId));
  }, [qc, channelId]);

  if (isLoading || !hydrated) return <MessageSkeletons />;
  if (error || !channel) {
    const gone = error instanceof ApiError && error.status === 404;
    return (
      <div className="p-6">
        {gone ? (
          <EmptyState
            title="Conversation not found"
            description="It may have been deleted, or it is a private channel you are not part of."
            action={
              <Button variant="outline" onClick={() => router.push('/messages')}>
                Back to messages
              </Button>
            }
          />
        ) : (
          <LoadError what="this conversation" />
        )}
      </div>
    );
  }

  /** Shows a reply only the sender sees. */
  const say = (text: string, cards: ItemCardDTO[] = []) =>
    setEphemeral((cur) => [...cur.slice(-4), { id: ++ephemeralId.current, text, cards }]);

  /** Runs a slash command and acts on what it asks for. Rejects (keeping the text) when it fails. */
  async function runCommand(c: { name: string; args: string }) {
    let result: CommandResult;
    try {
      result = await executeCommand(c.name, c.args, channelId);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'That command did not work');
      throw e;
    }
    if (result.kind === 'ephemeral') say(result.text, result.cards ?? (result.card ? [result.card] : []));
    else if (result.kind === 'open_create') setCreateTitle(result.title);
    else if (result.kind === 'done') toast.success(result.text);
    else {
      try {
        await api(result.path, { method: result.method, body: result.body });
        toast.success(result.text);
        void qc.invalidateQueries({ queryKey: ['checkin'] });
        void qc.invalidateQueries({ queryKey: ['me', 'today'] });
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : 'That did not work');
        throw e;
      }
    }
  }

  const name = conversationName(channel, meUser.id);
  const kind = perms.isDm ? 'dm' : channel.type === 'private' ? 'private' : 'channel';
  const view: ChannelView | undefined = messages.data;
  const roster = (members.data ?? []).map((m) => m.person).filter((p): p is PersonDTO => !!p);

  const composerNotice = !isMember
    ? null
    : channel.isArchived
      ? 'This channel is archived. You can read it, but not post.'
      : channel.readOnly
        ? 'You can read this channel because you can view the space. Only people with member access to the space can post.'
        : !perms.canPost
          ? 'Only owners and admins can post here. You can still react and reply in threads.'
          : null;

  const canDrop = perms.canPost && tab === 'messages';
  const dropHandlers = canDrop
    ? {
        onDragEnter: (e: React.DragEvent) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          dragDepth.current++;
          setDragging(true);
        },
        onDragOver: (e: React.DragEvent) => {
          if (e.dataTransfer.types.includes('Files')) e.preventDefault();
        },
        onDragLeave: () => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        },
        onDrop: (e: React.DragEvent) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          composer.current?.addFiles([...e.dataTransfer.files]);
        },
      }
    : {};

  return (
    <div className="relative flex h-full min-h-0 flex-col" {...dropHandlers}>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4 sm:px-5">
        <Button
          variant="ghost"
          size="icon-sm"
          className={docked ? 'hidden' : 'md:hidden'}
          aria-label="Back to conversations"
          onClick={() => router.push('/messages')}
        >
          <ArrowLeft />
        </Button>
        {perms.isDm ? (
          channel.type === 'group_dm' ? (
            <Users className="text-muted-foreground size-4 shrink-0" aria-hidden />
          ) : (
            <ProfilePopover person={channel.people?.[0] ?? null}>
              <button
                type="button"
                aria-label={`Profile of ${name}`}
                className="focus-visible:ring-ring/50 rounded-full outline-none focus-visible:ring-2"
              >
                <PersonAvatar person={channel.people?.[0] ?? null} size="sm" />
              </button>
            </ProfilePopover>
          )
        ) : channel.type === 'private' ? (
          <Lock className="text-muted-foreground size-4 shrink-0" aria-hidden />
        ) : (
          <Hash className="text-muted-foreground size-4 shrink-0" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-title leading-tight font-semibold">{name}</h1>
          {channel.topic && !perms.isDm && (
            <p className="text-muted-foreground truncate text-xs">{channel.topic}</p>
          )}
        </div>
        {channel.spaceId && !docked && (
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link href={`/spaces/${(channel.name ?? '').replace(/-space$/, '').toUpperCase()}`}>
              <Boxes /> Space
            </Link>
          </Button>
        )}
        {channel.isAnnouncement && (
          <Megaphone
            className="text-muted-foreground size-4 shrink-0"
            aria-label="Announcements only"
          />
        )}
        {channel.isArchived && (
          <Archive className="text-muted-foreground size-4 shrink-0" aria-label="Archived" />
        )}
        {docked && (
          <Button asChild variant="ghost" size="sm">
            <a href={`/messages/${channelId}`}>Open in Messages</a>
          </Button>
        )}
        <button
          type="button"
          hidden={docked}
          onClick={panel.toggle}
          aria-label={`${channel.memberCount} members. Show details`}
          aria-expanded={panel.open}
          className="hover:bg-accent focus-visible:ring-ring/50 hidden items-center gap-2 rounded-md px-1.5 py-1 outline-none focus-visible:ring-[3px] sm:flex"
        >
          <span className="flex -space-x-2">
            {roster.slice(0, 3).map((p) => (
              <PersonAvatar
                key={p.id}
                person={p}
                size="sm"
                presence={false}
                className="ring-background rounded-full ring-2"
              />
            ))}
          </span>
          <span className="text-muted-foreground text-xs tabular-nums">{channel.memberCount}</span>
        </button>
        {docked && onClose && (
          <Button variant="ghost" size="icon-sm" aria-label="Close chat" onClick={onClose}>
            <X />
          </Button>
        )}
        <Button
          variant={panel.open ? 'secondary' : 'ghost'}
          size="icon-sm"
          className={docked ? 'hidden' : undefined}
          aria-label="Channel details"
          aria-pressed={panel.open}
          onClick={panel.toggle}
        >
          <Info />
        </Button>
      </header>

      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as Tab)}
        className="shrink-0 border-b px-4 sm:px-5"
      >
        <TabsList aria-label="Conversation views" className="h-9 bg-transparent p-0">
          <TabsTrigger
            value="messages"
            className="data-[state=active]:bg-transparent data-[state=active]:shadow-none"
          >
            Messages
          </TabsTrigger>
          <TabsTrigger
            value="pins"
            className="data-[state=active]:bg-transparent data-[state=active]:shadow-none"
          >
            Pins
          </TabsTrigger>
          <TabsTrigger
            value="files"
            className="data-[state=active]:bg-transparent data-[state=active]:shadow-none"
          >
            Files
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <ConnectionBanner />

      {!isMember && !perms.isDm && (
        <div className="bg-muted/60 flex flex-wrap items-center gap-3 border-b px-4 py-2.5 text-sm sm:px-5">
          <span className="flex-1">
            You are previewing #{channel.name}. Join to post and get notified.
          </span>
          <Button
            size="sm"
            loading={join.isPending}
            onClick={() =>
              join.mutate(channelId, {
                onSuccess: () => toast.success(`Joined #${channel.name}`),
                onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not join'),
              })
            }
          >
            Join channel
          </Button>
        </div>
      )}

      {tab === 'pins' ? (
        <PinsView channelId={channelId} canPin={perms.canPin} rowProps={actions.rowProps} />
      ) : tab === 'files' ? (
        <FilesView
          channelId={channelId}
          onOpenImage={(images, index) => setLightbox({ images, index })}
        />
      ) : messages.isError && !view ? (
        <div className="p-6">
          <LoadError what="the messages" onRetry={() => void messages.refetch()} />
        </div>
      ) : !view ? (
        <MessageSkeletons />
      ) : view.messages.length === 0 && pending.length === 0 && !view.hasOlder ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <EmptyState
            icon={MessageSquarePlus}
            title={perms.isDm ? `Say hello to ${name}` : `Nothing in #${channel.name} yet`}
            description={
              perms.canPost
                ? 'Be the first to write something.'
                : 'Messages will appear here as people post.'
            }
          />
        </div>
      ) : (
        <MessageList
          channelId={channelId}
          view={view}
          self={self}
          selfId={meUser.id}
          pending={pending}
          initialLastReadSeq={initialLastReadSeq}
          focusSeq={focusSeq}
          intro={
            <Intro
              name={perms.isDm ? name : (channel.name ?? '')}
              kind={kind}
              topic={channel.topic}
              limited={view.historyLimited === true}
            />
          }
          renderMessage={(m, grouped, highlighted) => (
            <MessageRow {...actions.rowProps(m, { grouped, highlighted })} />
          )}
          onLoadOlder={onLoadOlder}
          onJumpLatest={() => void jumpLatest()}
          onMarkRead={(seq) => isMember && rt.markRead(channelId, seq)}
          onRetry={(id) => void rt.retry(id)}
          onDiscard={rt.discard}
        />
      )}

      {view && tab === 'messages' && <LiveAnnouncer messages={view.messages} selfId={meUser.id} />}
      {ephemeral.length > 0 && (
        <ul className="space-y-2 px-4 pb-2 sm:px-5" aria-label="Only visible to you">
          {ephemeral.map((e) => (
            <li key={e.id} className="bg-muted/40 rounded-lg border border-dashed p-3">
              <p className="text-muted-foreground mb-1 flex items-center gap-2 text-xs">
                Only visible to you
                <button
                  type="button"
                  className="hover:text-foreground ml-auto underline"
                  onClick={() => setEphemeral((cur) => cur.filter((x) => x.id !== e.id))}
                >
                  Dismiss
                </button>
              </p>
              <p className="text-sm">{e.text}</p>
              {e.cards.length > 0 && (
                <ul className="mt-2 space-y-1.5">
                  {e.cards.map((c) => (
                    <li key={c.access ? c.id : c.key}>
                      <ItemCardView card={c} />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      <TypingIndicator channelId={channelId} selfId={meUser.id} people={people} />

      <div className="px-4 pb-4 sm:px-5 sm:pb-5">
        {composerNotice ? (
          <p className="text-muted-foreground bg-muted/50 rounded-lg border border-dashed px-3 py-3 text-center text-sm">
            {composerNotice}
          </p>
        ) : isMember ? (
          <Composer
            key={channelId}
            handleRef={composer}
            draftKey={channelId}
            channelId={channelId}
            autoFocus
            placeholder={perms.isDm ? `Message ${name}` : `Message #${channel.name}`}
            commands={commands.data}
            onTyping={() => rt.typing(channelId)}
            onEditLast={() => {
              const last = [...(view?.messages ?? [])]
                .reverse()
                .find((m) => m.authorId === meUser.id && m.kind === 'user' && !m.deletedAt);
              if (last) actions.setEditingId(last.id);
            }}
            onSubmit={async (doc, text, extra) => {
              const command = parseCommand(text, commands.data);
              if (!command) return rt.send(channelId, doc, text, { files: extra.files });
              await runCommand(command);
            }}
          />
        ) : null}
      </div>

      {dragging && (
        <div
          className="bg-primary/10 border-primary text-primary pointer-events-none absolute inset-2 z-30 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed backdrop-blur-[1px]"
          role="status"
        >
          <Upload className="size-8" aria-hidden />
          <p className="font-medium">
            Drop files to share in {perms.isDm ? name : `#${channel.name}`}
          </p>
        </div>
      )}

      <CreateWorkDialog
        message={null}
        prefillTitle={createTitle ?? ''}
        defaultSpaceId={channel.spaceId}
        spaces={creatable}
        open={createTitle !== null}
        onOpenChange={(o) => !o && setCreateTitle(null)}
      />
      {actions.nodes}
      {lightbox && (
        <ImageLightbox
          images={lightbox.images}
          index={lightbox.index}
          onIndex={(index) => setLightbox({ ...lightbox, index })}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}
