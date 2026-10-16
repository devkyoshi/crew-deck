'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Archive,
  ArchiveRestore,
  Crown,
  Hash,
  LogOut,
  MoreHorizontal,
  Trash2,
  UserMinus,
  UserPlus,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useIsAdmin, useMe } from '@/components/shell/me-context';
import { ApiError } from '@/lib/api';
import {
  channelPerms,
  conversationName,
  personName,
  useArchiveChannel,
  useDeleteChannel,
  useLeaveChannel,
  useMembers,
  useRemoveMember,
  useSetMemberRole,
  useUpdateChannel,
  useUpdateMyMembership,
  type ChannelDTO,
  type MyChannelDTO,
  type NotificationLevel,
} from '@/lib/messaging-api';
import { AddPeopleDialog } from './dialogs';
import { PersonAvatar } from './person-avatar';

type Channel = ChannelDTO & Partial<MyChannelDTO>;

const fail = (e: unknown, fallback: string) =>
  toast.error(e instanceof ApiError ? e.message : fallback);

function About({ channel, canManage }: { channel: Channel; canManage: boolean }) {
  const update = useUpdateChannel();
  const [topic, setTopic] = useState(channel.topic ?? '');
  const [description, setDescription] = useState(channel.description ?? '');
  useEffect(() => setTopic(channel.topic ?? ''), [channel.topic]);
  useEffect(() => setDescription(channel.description ?? ''), [channel.description]);
  const save = (patch: { topic?: string | null; description?: string | null }) =>
    update.mutate({ id: channel.id, ...patch }, { onError: (e) => fail(e, 'Could not save') });

  if (!canManage) {
    return (
      <section className="space-y-3">
        <div>
          <h3 className="text-muted-foreground mb-1 text-xs font-semibold tracking-wide uppercase">
            Topic
          </h3>
          <p className="text-sm">
            {channel.topic || <span className="text-muted-foreground">No topic set</span>}
          </p>
        </div>
        {channel.description && (
          <div>
            <h3 className="text-muted-foreground mb-1 text-xs font-semibold tracking-wide uppercase">
              Description
            </h3>
            <p className="text-sm whitespace-pre-wrap">{channel.description}</p>
          </div>
        )}
      </section>
    );
  }
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <label
          htmlFor="d-topic"
          className="text-muted-foreground text-xs font-semibold tracking-wide uppercase"
        >
          Topic
        </label>
        <Input
          id="d-topic"
          value={topic}
          maxLength={250}
          placeholder="Add a topic"
          onChange={(e) => setTopic(e.target.value)}
          onBlur={() =>
            topic.trim() !== (channel.topic ?? '') && save({ topic: topic.trim() || null })
          }
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </div>
      <div className="space-y-1">
        <label
          htmlFor="d-desc"
          className="text-muted-foreground text-xs font-semibold tracking-wide uppercase"
        >
          Description
        </label>
        <Textarea
          id="d-desc"
          value={description}
          maxLength={1000}
          rows={3}
          placeholder="What is this channel for?"
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() =>
            description.trim() !== (channel.description ?? '') &&
            save({ description: description.trim() || null })
          }
        />
      </div>
    </section>
  );
}

function Members({ channel, canManage }: { channel: Channel; canManage: boolean }) {
  const me = useMe().user.id;
  const members = useMembers(channel.id);
  const remove = useRemoveMember(channel.id);
  const role = useSetMemberRole(channel.id);
  const [adding, setAdding] = useState(false);
  const isDm = channel.type === 'dm' || channel.type === 'group_dm';
  const canAdd = !isDm && (canManage || (channel.type === 'public' && !!channel.role));
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
          Members · {channel.memberCount}
        </h3>
        {canAdd && (
          <Button size="xs" variant="outline" onClick={() => setAdding(true)}>
            <UserPlus /> Add
          </Button>
        )}
      </div>
      {members.isLoading && <p className="text-muted-foreground text-sm">Loading members…</p>}
      {members.isError && <p className="text-destructive text-sm">Could not load members.</p>}
      <ul className="-mx-1 space-y-px">
        {members.data?.map((m) => (
          <li
            key={m.userId}
            className="hover:bg-muted/60 flex items-center gap-2.5 rounded-md px-1 py-1.5"
          >
            <PersonAvatar person={m.person} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {personName(m.person)}
                {m.userId === me && (
                  <span className="text-muted-foreground font-normal"> (you)</span>
                )}
              </p>
              {m.person?.deactivated && (
                <p className="text-muted-foreground text-xs">Deactivated</p>
              )}
            </div>
            {m.role === 'owner' && !isDm && (
              <Badge variant="secondary" className="gap-1">
                <Crown className="size-3" /> Owner
              </Badge>
            )}
            {canManage && m.userId !== me && !isDm && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Actions for ${personName(m.person)}`}
                  >
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() =>
                      role.mutate(
                        { userId: m.userId, role: m.role === 'owner' ? 'member' : 'owner' },
                        { onError: (e) => fail(e, 'Could not change the role') },
                      )
                    }
                  >
                    <Crown /> {m.role === 'owner' ? 'Make member' : 'Make owner'}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() =>
                      remove.mutate(m.userId, { onError: (e) => fail(e, 'Could not remove them') })
                    }
                  >
                    <UserMinus /> Remove from channel
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </li>
        ))}
      </ul>
      <AddPeopleDialog
        channelId={channel.id}
        existing={members.data?.map((m) => m.userId) ?? []}
        open={adding}
        onOpenChange={setAdding}
      />
    </section>
  );
}

const LEVELS: { value: NotificationLevel; label: string }[] = [
  { value: 'all', label: 'Every new message' },
  { value: 'mentions', label: 'Only mentions' },
  { value: 'none', label: 'Nothing' },
];

export function ChannelDetails({
  channel,
  onClose,
  onGone,
}: {
  channel: Channel;
  onClose?: () => void;
  onGone: () => void;
}) {
  const router = useRouter();
  const isAdmin = useIsAdmin();
  const me = useMe().user.id;
  const perms = channelPerms({ ...channel, role: channel.role }, isAdmin);
  const mine = useUpdateMyMembership(channel.id);
  const leave = useLeaveChannel();
  const archive = useArchiveChannel();
  const del = useDeleteChannel();
  const [confirm, setConfirm] = useState<'leave' | 'delete' | null>(null);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <h2 className="text-sm font-semibold">Details</h2>
        {onClose && (
          <Button variant="ghost" size="icon-sm" aria-label="Close details" onClick={onClose}>
            <X />
          </Button>
        )}
      </header>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4">
        <div className="flex items-center gap-2">
          {!perms.isDm && <Hash className="text-muted-foreground size-5" aria-hidden />}
          <p className="min-w-0 flex-1 truncate text-lg font-semibold">
            {conversationName(channel, me)}
          </p>
          {channel.isArchived && <Badge variant="secondary">Archived</Badge>}
          {channel.isAnnouncement && <Badge variant="outline">Announcements</Badge>}
        </div>
        {!perms.isDm && (
          <About channel={channel} canManage={perms.canManage && !channel.isArchived} />
        )}
        <Members channel={channel} canManage={perms.canManage && !channel.isArchived} />

        {perms.member && (
          <section className="space-y-1.5">
            <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
              Notify me about
            </h3>
            <Select
              value={channel.notificationLevel ?? 'all'}
              onValueChange={(v) =>
                mine.mutate(
                  { notificationLevel: v as NotificationLevel },
                  { onError: (e) => fail(e, 'Could not save') },
                )
              }
            >
              <SelectTrigger aria-label="Notification level" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEVELS.map((l) => (
                  <SelectItem key={l.value} value={l.value}>
                    {l.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              Email and desktop alerts follow this setting once notifications are switched on.
            </p>
          </section>
        )}

        <section className="space-y-2 border-t pt-4">
          {perms.canLeave && (
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => setConfirm('leave')}
            >
              <LogOut /> Leave {perms.isDm ? 'conversation' : 'channel'}
            </Button>
          )}
          {perms.canManage && (
            <Button
              variant="outline"
              className="w-full justify-start"
              loading={archive.isPending}
              onClick={() =>
                archive.mutate(
                  { id: channel.id, archived: !channel.isArchived },
                  { onError: (e) => fail(e, 'Could not change the channel') },
                )
              }
            >
              {channel.isArchived ? <ArchiveRestore /> : <Archive />}{' '}
              {channel.isArchived ? 'Unarchive channel' : 'Archive channel'}
            </Button>
          )}
          {perms.canDeleteChannel && (
            <Button
              variant="outline"
              className="text-destructive w-full justify-start"
              onClick={() => setConfirm('delete')}
            >
              <Trash2 /> Delete channel
            </Button>
          )}
        </section>
      </div>

      <AlertDialog open={confirm === 'leave'} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave {conversationName(channel, me)}?</AlertDialogTitle>
            <AlertDialogDescription>
              {channel.type === 'private'
                ? 'This channel is private, so you will need to be invited to come back.'
                : 'You can rejoin from the channel browser at any time.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                leave.mutate(channel.id, {
                  onSuccess: () => {
                    onGone();
                    router.push('/messages');
                  },
                  onError: (e) => fail(e, 'Could not leave'),
                })
              }
            >
              Leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirm === 'delete'} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete #{channel.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Every message in it is deleted for good and nobody can get them back. This is recorded
              in the audit log.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-white"
              onClick={() =>
                del.mutate(channel.id, {
                  onSuccess: () => {
                    onGone();
                    toast.success('Channel deleted');
                    router.push('/messages');
                  },
                  onError: (e) => fail(e, 'Could not delete'),
                })
              }
            >
              Delete channel
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
