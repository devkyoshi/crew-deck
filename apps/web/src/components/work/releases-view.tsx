'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Archive, Check, Copy, FileText, ListFilter, MoreHorizontal, Pencil, Plus, Rocket, Trash2 } from 'lucide-react';
import { toast } from '@/lib/toast';
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
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState } from '@/components/shared/empty-state';
import { LoadError } from '@/components/shared/load-error';
import { LockedButton } from '@/components/plans/locked-button';
import { useSpace } from '@/components/spaces/space-context';
import { RESOLUTION_LABEL, TYPE_META, type Person } from '@/lib/work';
import { toastError } from '@/lib/work-api';
import {
  useComponentMutations,
  useComponents,
  useReleaseNotes,
  useVersionMutations,
  useVersions,
  type SpaceComponent,
  type Version,
} from '@/lib/versions-api';
import { cn } from '@/lib/utils';
import { AssigneePicker } from './work-pickers';
import { UserAvatar } from './work-bits';
import { ListSkeleton } from '@/components/shared/skeletons';

const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

const STATE_STYLE: Record<Version['state'], string> = {
  unreleased: 'bg-info-soft text-info-soft-foreground ',
  released: 'bg-success-soft text-success-soft-foreground ',
  archived: 'bg-muted text-muted-foreground',
};

/** Releases (versions) with their progress, and the space's components. */
export function ReleasesView() {
  const space = useSpace();
  const versions = useVersions(space.key);
  const m = useVersionMutations(space.key);
  const [editing, setEditing] = useState<Version | 'new' | null>(null);
  const [releasing, setReleasing] = useState<Version | null>(null);
  const [notesFor, setNotesFor] = useState<Version | null>(null);
  const [deleting, setDeleting] = useState<Version | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  if (versions.isError) return <LoadError what="the releases" onRetry={() => void versions.refetch()} />;
  if (!versions.data) return <ListSkeleton rows={3} />;
  const { items, permissions, feature } = versions.data;
  const visible = items.filter((v) => showArchived || v.state !== 'archived');
  const hasArchived = items.some((v) => v.state === 'archived');

  return (
    <div className="space-y-8">
      <section aria-labelledby="rel-h" className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="rel-h" className="text-base font-semibold">
            Releases
          </h2>
          {hasArchived && (
            <label className="text-muted-foreground ml-2 flex items-center gap-1.5 text-xs">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
            </label>
          )}
          <div className="ml-auto">
            {!feature ? (
              <LockedButton>New version</LockedButton>
            ) : permissions.manage ? (
              <Button size="sm" onClick={() => setEditing('new')}>
                <Plus /> New version
              </Button>
            ) : null}
          </div>
        </div>

        {!feature && (
          <p className="rounded-lg bg-warning-soft p-3 text-sm text-warning-soft-foreground ">
            Releases are included from the Team plan. Components below are available on every plan.
          </p>
        )}

        {visible.length === 0 ? (
          <EmptyState
            icon={Rocket}
            title="No releases yet"
            description="Group finished work into a version, then release it to get release notes."
            action={
              feature && permissions.manage ? (
                <Button onClick={() => setEditing('new')}>
                  <Plus /> New version
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="space-y-2">
            {visible.map((v) => (
              <li key={v.id} className="bg-card space-y-2 rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-medium">{v.name}</h3>
                  <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium capitalize', STATE_STYLE[v.state])}>{v.state}</span>
                  {v.overdue && (
                    <span className="rounded-full bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger-soft-foreground ">
                      Overdue
                    </span>
                  )}
                  <span className="text-muted-foreground text-xs">
                    {v.startDate && `${day(v.startDate)} to `}
                    {v.releaseDate ? (v.state === 'released' ? `released ${day(v.releaseDate)}` : `due ${day(v.releaseDate)}`) : v.startDate ? '…' : 'No dates'}
                  </span>
                  <div className="ml-auto flex items-center gap-1">
                    {v.state === 'unreleased' && permissions.release && (
                      <Button size="sm" variant="outline" className="h-8" onClick={() => setReleasing(v)}>
                        <Rocket /> Release
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="h-8" onClick={() => setNotesFor(v)}>
                      <FileText /> Notes
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-8" aria-label={`More for ${v.name}`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link href={`/spaces/${space.key}/list?version=${v.id}`}>
                            <ListFilter /> Show its work
                          </Link>
                        </DropdownMenuItem>
                        {feature && permissions.manage && (
                          <>
                            <DropdownMenuItem onSelect={() => setEditing(v)}>
                              <Pencil /> Edit
                            </DropdownMenuItem>
                            {v.state !== 'archived' && (
                              <DropdownMenuItem
                                onSelect={() => m.update.mutate({ id: v.id, state: 'archived' }, { onError: (e) => toastError(e) })}
                              >
                                <Archive /> Archive
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(v)}>
                              <Trash2 /> Delete
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                {v.description && <p className="text-muted-foreground text-sm">{v.description}</p>}
                <div className="flex items-center gap-3">
                  <Progress value={v.total ? (v.done / v.total) * 100 : 0} aria-label={`${v.name} progress`} className="h-1.5 flex-1" />
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {v.done} of {v.total} done{v.open ? `, ${v.open} open` : ''}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ComponentsSection />

      {editing && (
        <VersionDialog
          version={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          save={(body) =>
            editing === 'new' ? m.create.mutateAsync(body) : m.update.mutateAsync({ id: editing.id, ...body })
          }
        />
      )}

      <ReleaseDialog
        version={releasing}
        others={items.filter((v) => v.state === 'unreleased' && v.id !== releasing?.id)}
        onClose={() => setReleasing(null)}
        onRelease={(moveOpenTo) =>
          m.release.mutate(
            { id: releasing!.id, moveOpenTo },
            {
              onSuccess: (r) => {
                toast.success(`${releasing!.name} released${r.moved ? `, ${r.moved} open moved on` : r.removed ? `, ${r.removed} open taken out` : ''}`);
                setReleasing(null);
              },
              onError: (e) => toastError(e, 'Could not release it'),
            },
          )
        }
      />

      <NotesDialog version={notesFor} onClose={() => setNotesFor(null)} />

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              It is taken off its {deleting?.total} item{deleting?.total === 1 ? '' : 's'}. The items stay.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => m.remove.mutate(deleting!.id, { onError: (e) => toastError(e, 'Could not delete it'), onSettled: () => setDeleting(null) })}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function VersionDialog({
  version,
  onClose,
  save,
}: {
  version: Version | null;
  onClose: () => void;
  save: (b: { name: string; description: string; startDate: string | null; releaseDate: string | null }) => Promise<unknown>;
}) {
  const [name, setName] = useState(version?.name ?? '');
  const [description, setDescription] = useState(version?.description ?? '');
  const [startDate, setStartDate] = useState(version?.startDate ?? '');
  const [releaseDate, setReleaseDate] = useState(version?.releaseDate ?? '');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await save({ name: name.trim(), description: description.trim(), startDate: startDate || null, releaseDate: releaseDate || null });
              onClose();
            } catch (err) {
              toastError(err, 'Could not save the version');
            } finally {
              setBusy(false);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{version ? 'Edit version' : 'New version'}</DialogTitle>
            <DialogDescription>A release that work can be planned into.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="ver-name">Name</Label>
            <Input id="ver-name" autoFocus maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="For example 1.4.0" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ver-start">Start</Label>
              <Input id="ver-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ver-release">Release date</Label>
              <Input id="ver-release" type="date" value={releaseDate} onChange={(e) => setReleaseDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ver-desc">Description</Label>
            <Textarea id="ver-desc" rows={3} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || busy}>
              {version ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReleaseDialog({
  version,
  others,
  onClose,
  onRelease,
}: {
  version: Version | null;
  others: Version[];
  onClose: () => void;
  onRelease: (moveOpenTo: string | null) => void;
}) {
  const [target, setTarget] = useState('none');
  return (
    <Dialog open={!!version} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Release {version?.name}</DialogTitle>
          <DialogDescription>
            {version?.open
              ? `${version.open} item${version.open === 1 ? ' is' : 's are'} not finished. Choose where they go.`
              : 'Everything in this version is finished.'}
          </DialogDescription>
        </DialogHeader>
        {!!version?.open && (
          <div className="space-y-1.5">
            <Label htmlFor="rel-target">Unfinished work</Label>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger id="rel-target">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Take it out of this version</SelectItem>
                {others.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    Move to {o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onRelease(target === 'none' || !version?.open ? null : target)}>Release</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NotesDialog({ version, onClose }: { version: Version | null; onClose: () => void }) {
  const space = useSpace();
  const notes = useReleaseNotes(version?.id ?? null);
  const [copied, setCopied] = useState(false);
  const asText = () => {
    if (!notes.data) return '';
    const lines = [`${notes.data.version.name}${notes.data.version.releaseDate ? ` (${notes.data.version.releaseDate})` : ''}`];
    for (const g of notes.data.groups) {
      lines.push('', `${TYPE_META[g.type].label}s`);
      for (const i of g.items) lines.push(`- ${i.key} ${i.title}`);
    }
    return lines.join('\n');
  };
  return (
    <Dialog open={!!version} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{version?.name} release notes</DialogTitle>
          <DialogDescription>Finished work in this version, by type.</DialogDescription>
        </DialogHeader>
        {notes.isError ? (
          <LoadError what="the release notes" onRetry={() => void notes.refetch()} />
        ) : !notes.data ? (
          <ListSkeleton rows={3} />
        ) : (
          <div className="space-y-4 text-sm">
            {notes.data.groups.length === 0 && <p className="text-muted-foreground">Nothing finished in this version yet.</p>}
            {notes.data.groups.map((g) => (
              <section key={g.type} aria-label={`${TYPE_META[g.type].label}s`}>
                <h3 className="mb-1 font-semibold">{TYPE_META[g.type].label}s</h3>
                <ul className="space-y-0.5">
                  {g.items.map((i) => (
                    <li key={i.id}>
                      <Link href={`/spaces/${space.key}/items/${i.key}`} className="hover:underline">
                        <span className="text-muted-foreground tabular-nums">{i.key}</span> {i.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            {notes.data.notShipped.length > 0 && (
              <section aria-label="Not shipped">
                <h3 className="text-muted-foreground mb-1 font-semibold">Not shipped</h3>
                <ul className="text-muted-foreground space-y-0.5">
                  {notes.data.notShipped.map((i) => (
                    <li key={i.id}>
                      <span className="tabular-nums">{i.key}</span> {i.title}
                      {i.resolution && i.resolution !== 'done' ? ` (${RESOLUTION_LABEL[i.resolution]})` : ' (open)'}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={!notes.data}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(asText());
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {
                toast.error('Could not copy');
              }
            }}
          >
            {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy as text'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ComponentsSection() {
  const space = useSpace();
  const components = useComponents(space.key);
  const m = useComponentMutations(space.key);
  const [editing, setEditing] = useState<SpaceComponent | 'new' | null>(null);
  if (components.isError) return <LoadError what="the components" onRetry={() => void components.refetch()} />;
  if (!components.data) return null;
  const { items, permissions } = components.data;
  return (
    <section aria-labelledby="comp-h" className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 id="comp-h" className="text-base font-semibold">
          Components
        </h2>
        {permissions.manageComponents && (
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => setEditing('new')}>
            <Plus /> New component
          </Button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Components are parts of your product. Work in a component can go to its default assignee.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {items.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{c.name}</p>
                {c.description && <p className="text-muted-foreground truncate text-xs">{c.description}</p>}
              </div>
              <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                Lead <UserAvatar person={c.lead} size={20} /> {c.lead ? (c.lead.name ?? c.lead.email) : 'none'}
              </span>
              <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                Default assignee <UserAvatar person={c.defaultAssignee} size={20} /> {c.defaultAssignee ? (c.defaultAssignee.name ?? c.defaultAssignee.email) : 'none'}
              </span>
              <span className="text-muted-foreground text-xs tabular-nums">{c.itemCount} items</span>
              {permissions.manageComponents && (
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="size-8" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)}>
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label={`Delete ${c.name}`}
                    onClick={() => m.remove.mutate(c.id, { onError: (e) => toastError(e, 'Could not delete it') })}
                  >
                    <Trash2 />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <ComponentDialog
          component={editing === 'new' ? null : editing}
          spaceKey={space.key}
          onClose={() => setEditing(null)}
          save={(b) => (editing === 'new' ? m.create.mutateAsync(b) : m.update.mutateAsync({ id: editing.id, ...b }))}
        />
      )}
    </section>
  );
}

function ComponentDialog({
  component,
  spaceKey,
  onClose,
  save,
}: {
  component: SpaceComponent | null;
  spaceKey: string;
  onClose: () => void;
  save: (b: { name: string; leadId: string | null; defaultAssigneeId: string | null }) => Promise<unknown>;
}) {
  const [name, setName] = useState(component?.name ?? '');
  const [lead, setLead] = useState<Person | null>(component?.lead ?? null);
  const [assignee, setAssignee] = useState<Person | null>(component?.defaultAssignee ?? null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await save({ name: name.trim(), leadId: lead?.id ?? null, defaultAssigneeId: assignee?.id ?? null });
              onClose();
            } catch (err) {
              toastError(err, 'Could not save the component');
            } finally {
              setBusy(false);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{component ? 'Edit component' : 'New component'}</DialogTitle>
            <DialogDescription>New work in a component with no assignee goes to its default assignee.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="comp-name">Name</Label>
            <Input id="comp-name" autoFocus maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="comp-lead">Lead</Label>
            <AssigneePicker id="comp-lead" space={spaceKey} value={lead} onChange={setLead} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="comp-assignee">Default assignee</Label>
            <AssigneePicker id="comp-assignee" space={spaceKey} value={assignee} onChange={setAssignee} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || busy}>
              {component ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
