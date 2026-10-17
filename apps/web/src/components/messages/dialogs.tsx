'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Globe, Hash, Lock, Megaphone, Search } from 'lucide-react';
import { toast } from '@/lib/toast';
import { CHANNEL_NAME_RE, GROUP_DM_MAX } from '@crew-deck/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ToggleCard } from '@/components/ui/toggle-card';
import { Stepper } from '@/components/shared/stepper';
import { ApiError, type Member } from '@/lib/api';
import {
  useAddMembers,
  useBrowse,
  useCreateChannel,
  useJoinChannel,
  useOpenDm,
} from '@/lib/messaging-api';
import { PeoplePicker } from './people-picker';

const slugify = (v: string) =>
  v
    .toLowerCase()
    .replace(/[^a-z0-9-\s]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);

// ---- New message -------------------------------------------------------------------------------------

/** Pick one person for a direct message, or up to seven for a group message. */
export function NewMessageDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();
  const [people, setPeople] = useState<Member[]>([]);
  const openDm = useOpenDm();
  const go = () =>
    openDm.mutate(
      people.map((p) => p.id),
      {
        onSuccess: ({ channel }) => {
          onOpenChange(false);
          setPeople([]);
          router.push(`/messages/${channel.id}`);
        },
        onError: (e) =>
          toast.error(e instanceof ApiError ? e.message : 'Could not start the conversation'),
      },
    );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New message</DialogTitle>
          <DialogDescription>
            Choose one person, or up to {GROUP_DM_MAX - 1} for a group conversation.
          </DialogDescription>
        </DialogHeader>
        <PeoplePicker value={people} onChange={setPeople} max={GROUP_DM_MAX - 1} autoFocus />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={people.length === 0} loading={openDm.isPending} onClick={go}>
            {people.length > 1 ? 'Start group message' : 'Open conversation'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Create channel ----------------------------------------------------------------------------------

const STEPS = ['Name and type', 'Details', 'People', 'Review'];

export function CreateChannelDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();
  const create = useCreateChannel();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [type, setType] = useState<'public' | 'private'>('public');
  const [announcement, setAnnouncement] = useState(false);
  const [topic, setTopic] = useState('');
  const [description, setDescription] = useState('');
  const [people, setPeople] = useState<Member[]>([]);
  const [nameError, setNameError] = useState<string | null>(null);

  const reset = () => {
    setStep(0);
    setName('');
    setType('public');
    setAnnouncement(false);
    setTopic('');
    setDescription('');
    setPeople([]);
    setNameError(null);
  };
  const validName = CHANNEL_NAME_RE.test(name);

  const next = () => {
    if (step === 0 && !validName)
      return setNameError('Use lowercase letters, numbers and hyphens.');
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };
  const submit = () =>
    create.mutate(
      {
        name,
        type,
        topic: topic.trim() || null,
        description: description.trim() || null,
        isAnnouncement: announcement,
        memberIds: people.map((p) => p.id),
      },
      {
        onSuccess: ({ channel }) => {
          onOpenChange(false);
          reset();
          toast.success(`#${channel.name} created`);
          router.push(`/messages/${channel.id}`);
        },
        onError: (e) => {
          if (e instanceof ApiError && e.code === 'name_taken') {
            setNameError('A channel with that name already exists.');
            setStep(0);
          } else toast.error(e instanceof ApiError ? e.message : 'Could not create the channel');
        },
      },
    );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create a channel</DialogTitle>
          <DialogDescription>Channels keep a topic’s conversation in one place.</DialogDescription>
        </DialogHeader>
        <Stepper steps={STEPS} current={step} />
        <form
          className="min-h-64 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (step < STEPS.length - 1) next();
            else submit();
          }}
        >
          {step === 0 && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="ch-name">Name</Label>
                <div className="relative">
                  <Hash
                    className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
                    aria-hidden
                  />
                  <Input
                    id="ch-name"
                    autoFocus
                    value={name}
                    maxLength={80}
                    onChange={(e) => {
                      setName(slugify(e.target.value));
                      setNameError(null);
                    }}
                    placeholder="project-launch"
                    aria-invalid={!!nameError}
                    aria-describedby="ch-name-help"
                    className="pl-8"
                  />
                </div>
                <p
                  id="ch-name-help"
                  className={
                    nameError ? 'text-destructive text-xs' : 'text-muted-foreground text-xs'
                  }
                  role={nameError ? 'alert' : undefined}
                >
                  {nameError ?? 'Lowercase letters, numbers and hyphens. Spaces become hyphens.'}
                </p>
              </div>
              <fieldset className="space-y-2">
                <legend className="mb-1.5 text-sm font-medium">Who can see it</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  <ToggleCard
                    pressed={type === 'public'}
                    onClick={() => setType('public')}
                    className="space-y-1 p-3"
                  >
                    <Globe className="size-4" aria-hidden />
                    <span className="block text-sm font-medium">Public</span>
                    <span className="text-muted-foreground block text-xs">
                      Anyone in the workspace can find and join.
                    </span>
                  </ToggleCard>
                  <ToggleCard
                    pressed={type === 'private'}
                    onClick={() => setType('private')}
                    className="space-y-1 p-3"
                  >
                    <Lock className="size-4" aria-hidden />
                    <span className="block text-sm font-medium">Private</span>
                    <span className="text-muted-foreground block text-xs">
                      Only people you add can see it.
                    </span>
                  </ToggleCard>
                </div>
              </fieldset>
              <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                <div className="space-y-0.5">
                  <Label htmlFor="ch-ann" className="flex items-center gap-1.5">
                    <Megaphone className="size-4" aria-hidden /> Announcements only
                  </Label>
                  <p className="text-muted-foreground text-xs">
                    Only owners and admins post. Everyone else can read.
                  </p>
                </div>
                <Switch id="ch-ann" checked={announcement} onCheckedChange={setAnnouncement} />
              </div>
            </>
          )}
          {step === 1 && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="ch-topic">Topic (optional)</Label>
                <Input
                  id="ch-topic"
                  autoFocus
                  value={topic}
                  maxLength={250}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="What is this channel focused on right now?"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ch-desc">Description (optional)</Label>
                <Textarea
                  id="ch-desc"
                  value={description}
                  maxLength={1000}
                  rows={4}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Why does this channel exist?"
                />
              </div>
            </>
          )}
          {step === 2 && (
            <div className="space-y-2">
              <p className="text-muted-foreground text-sm">
                {type === 'public'
                  ? 'Optional. Anyone can join a public channel later.'
                  : 'Private channels are only visible to the people you add.'}
              </p>
              <PeoplePicker value={people} onChange={setPeople} autoFocus />
            </div>
          )}
          {step === 3 && (
            <dl className="divide-y rounded-lg border text-sm">
              {[
                ['Name', `#${name}`],
                ['Visibility', type === 'public' ? 'Public' : 'Private'],
                ['Posting', announcement ? 'Announcements only' : 'Everyone in the channel'],
                ['Topic', topic.trim() || 'None'],
                [
                  'People',
                  people.length
                    ? `You and ${people.length} other${people.length === 1 ? '' : 's'}`
                    : 'Just you',
                ],
              ].map(([k, v]) => (
                <div key={k} className="flex gap-4 px-3 py-2">
                  <dt className="text-muted-foreground w-24 shrink-0">{k}</dt>
                  <dd className="min-w-0 flex-1 break-words">{v}</dd>
                </div>
              ))}
            </dl>
          )}
          <DialogFooter className="pt-2">
            {step > 0 ? (
              <Button type="button" variant="ghost" onClick={() => setStep(step - 1)}>
                Back
              </Button>
            ) : (
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
            )}
            {step < STEPS.length - 1 ? (
              <Button type="submit" disabled={step === 0 && !name}>
                Continue
              </Button>
            ) : (
              <Button type="submit" loading={create.isPending}>
                Create channel
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---- Browse channels ---------------------------------------------------------------------------------

export function BrowseChannelsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const list = useBrowse(search.trim().toLowerCase(), open);
  const join = useJoinChannel();
  const go = (id: string) => {
    onOpenChange(false);
    router.push(`/messages/${id}`);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Browse channels</DialogTitle>
          <DialogDescription>
            Public channels in this workspace. Preview any of them before you join.
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search channels"
            aria-label="Search channels"
            className="pl-8"
          />
        </div>
        <ul
          className="max-h-80 divide-y overflow-y-auto rounded-md border"
          aria-label="Public channels"
        >
          {list.isLoading && (
            <li className="text-muted-foreground px-3 py-8 text-center text-sm">
              Loading channels…
            </li>
          )}
          {list.isError && (
            <li className="text-destructive px-3 py-8 text-center text-sm">
              Could not load channels.
            </li>
          )}
          {list.data?.length === 0 && (
            <li className="text-muted-foreground px-3 py-8 text-center text-sm">
              {search ? 'No channels match that search.' : 'There are no public channels yet.'}
            </li>
          )}
          {list.data?.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-3 py-2.5">
              <button
                type="button"
                onClick={() => go(c.id)}
                className="focus-visible:ring-ring/50 min-w-0 flex-1 rounded-sm text-left outline-none focus-visible:ring-2"
              >
                <span className="flex items-center gap-1 text-sm font-medium">
                  <Hash className="text-muted-foreground size-3.5" aria-hidden />
                  <span className="truncate">{c.name}</span>
                  {c.isAnnouncement && (
                    <Megaphone
                      className="text-muted-foreground size-3.5"
                      aria-label="Announcements only"
                    />
                  )}
                </span>
                <span className="text-muted-foreground block truncate text-xs">
                  {c.memberCount} member{c.memberCount === 1 ? '' : 's'}
                  {c.topic ? ` · ${c.topic}` : ''}
                </span>
              </button>
              {c.joined ? (
                <Button size="sm" variant="outline" onClick={() => go(c.id)}>
                  Open
                </Button>
              ) : (
                <Button
                  size="sm"
                  loading={join.isPending && join.variables === c.id}
                  onClick={() =>
                    join.mutate(c.id, {
                      onSuccess: () => go(c.id),
                      onError: (e) =>
                        toast.error(e instanceof ApiError ? e.message : 'Could not join'),
                    })
                  }
                >
                  Join
                </Button>
              )}
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

// ---- Add people --------------------------------------------------------------------------------------

export function AddPeopleDialog({
  channelId,
  existing,
  open,
  onOpenChange,
}: {
  channelId: string;
  existing: string[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [people, setPeople] = useState<Member[]>([]);
  const add = useAddMembers(channelId);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add people</DialogTitle>
          <DialogDescription>They will see the channel’s history from now on.</DialogDescription>
        </DialogHeader>
        <PeoplePicker
          value={people}
          onChange={setPeople}
          exclude={existing}
          includeSelf
          autoFocus
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={people.length === 0}
            loading={add.isPending}
            onClick={() =>
              add.mutate(
                people.map((p) => p.id),
                {
                  onSuccess: ({ added }) => {
                    toast.success(`${added} ${added === 1 ? 'person' : 'people'} added`);
                    setPeople([]);
                    onOpenChange(false);
                  },
                  onError: (e) =>
                    toast.error(e instanceof ApiError ? e.message : 'Could not add people'),
                },
              )
            }
          >
            Add {people.length > 0 ? people.length : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
