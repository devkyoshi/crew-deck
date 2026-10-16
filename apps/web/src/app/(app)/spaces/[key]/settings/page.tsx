'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { Archive, Globe, Lock, ShieldAlert, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState } from '@/components/shared/empty-state';
import { useSpace } from '@/components/spaces/space-context';
import { ServiceSlaSettings } from '@/components/work/service-sla-settings';
import { api, ApiError, qs, type SpaceDetail, type SpaceVisibility } from '@/lib/api';
import { forgetRecentSpace } from '@/lib/recent-spaces';
import { SPACE_ICONS, spaceIcon } from '@/lib/space-icons';
import { cn } from '@/lib/utils';

const schema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(80, 'Keep it under 80 characters'),
  description: z.string().trim().max(1000, 'Keep it under 1000 characters'),
  icon: z.string(),
});
type Values = z.infer<typeof schema>;

export default function SpaceSettingsPage() {
  const space = useSpace();
  const qc = useQueryClient();
  const router = useRouter();
  const archived = space.status === 'archived';

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['space'] });
    qc.invalidateQueries({ queryKey: ['spaces'] });
  };
  const fail = (e: unknown) =>
    toast.error(e instanceof ApiError ? e.message : 'Something went wrong');

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: space.name, description: space.description ?? '', icon: space.icon },
  });
  const icon = watch('icon');

  const [visibility, setVisibility] = useState<SpaceVisibility>(space.visibility);
  const [savingAccess, setSavingAccess] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  if (!space.permissions.edit) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Space admins only"
        description="You need to be an admin of this space to change its settings."
      />
    );
  }

  const saveGeneral = handleSubmit(async (v) => {
    try {
      await api<SpaceDetail>(`/spaces/${space.id}`, {
        method: 'PATCH',
        body: { name: v.name, description: v.description, icon: v.icon },
      });
      toast.success('Settings saved');
      refresh();
    } catch (e) {
      fail(e);
    }
  });

  async function saveAccess() {
    setSavingAccess(true);
    try {
      await api<SpaceDetail>(`/spaces/${space.id}`, { method: 'PATCH', body: { visibility } });
      toast.success(`Space is now ${visibility}`);
      refresh();
    } catch (e) {
      fail(e);
    } finally {
      setSavingAccess(false);
    }
  }

  async function setStatus(next: 'archive' | 'restore') {
    setBusy(true);
    try {
      await api<SpaceDetail>(`/spaces/${space.id}/${next}`, { method: 'POST', body: {} });
      toast.success(next === 'archive' ? 'Space archived' : 'Space restored');
      setConfirmArchive(false);
      refresh();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api(`/spaces/${space.id}${qs({ confirm: typed })}`, { method: 'DELETE' });
      toast.success('Space deleted');
      forgetRecentSpace(space.key);
      refresh();
      router.replace('/spaces');
    } catch (e) {
      fail(e);
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      {space.boardType === 'service' && (
        <Card>
          <CardHeader>
            <CardTitle>Response targets</CardTitle>
            <CardDescription>
              How quickly this desk answers and resolves tickets, by priority.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ServiceSlaSettings spaceKey={space.key} />
          </CardContent>
        </Card>
      )}
      <form onSubmit={saveGeneral} noValidate>
        <Card>
          <CardHeader>
            <CardTitle>General</CardTitle>
            <CardDescription>How this space appears across the workspace.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="s-name">Name</Label>
              <Input
                id="s-name"
                disabled={archived}
                aria-invalid={!!errors.name}
                {...register('name')}
              />
              {errors.name && <p className="text-destructive text-xs">{errors.name.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-key">Key</Label>
              <Input
                id="s-key"
                value={space.key}
                readOnly
                disabled
                className="max-w-40 font-mono"
              />
              <p className="text-muted-foreground text-xs">The key cannot be changed.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Icon</Label>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Icon">
                {Object.keys(SPACE_ICONS).map((name) => {
                  const Icon = spaceIcon(name);
                  const on = icon === name;
                  return (
                    <button
                      key={name}
                      type="button"
                      aria-pressed={on}
                      aria-label={name}
                      disabled={archived}
                      onClick={() => setValue('icon', name, { shouldDirty: true })}
                      className={cn(
                        'hover:bg-accent flex size-10 items-center justify-center rounded-xl border transition-colors disabled:opacity-50',
                        on &&
                          'border-primary bg-accent text-accent-foreground ring-primary/30 ring-2',
                      )}
                    >
                      <Icon className="size-5" aria-hidden />
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-desc">Description</Label>
              <Textarea id="s-desc" rows={3} disabled={archived} {...register('description')} />
              {errors.description && (
                <p className="text-destructive text-xs">{errors.description.message}</p>
              )}
            </div>
          </CardContent>
          <CardFooter className="justify-end">
            <Button type="submit" disabled={archived || isSubmitting || !isDirty}>
              {isSubmitting ? 'Saving…' : 'Save changes'}
            </Button>
          </CardFooter>
        </Card>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>Access</CardTitle>
          <CardDescription>Who can find and open this space.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2" role="group" aria-label="Visibility">
            {(
              [
                {
                  id: 'open',
                  icon: Globe,
                  title: 'Open',
                  text: 'Everyone in the workspace can view it.',
                },
                {
                  id: 'private',
                  icon: Lock,
                  title: 'Private',
                  text: 'Only added people, groups and admins.',
                },
              ] as const
            ).map((o) => (
              <button
                key={o.id}
                type="button"
                aria-pressed={visibility === o.id}
                disabled={archived}
                onClick={() => setVisibility(o.id)}
                className={cn(
                  'hover:bg-accent/60 space-y-1.5 rounded-2xl border p-4 text-left transition-colors disabled:opacity-50',
                  visibility === o.id && 'border-primary bg-accent ring-primary/30 ring-2',
                )}
              >
                <o.icon className="text-primary size-5" aria-hidden />
                <div className="font-medium">{o.title}</div>
                <p className="text-muted-foreground text-xs">{o.text}</p>
              </button>
            ))}
          </div>
        </CardContent>
        <CardFooter className="justify-end">
          <Button
            disabled={archived || savingAccess || visibility === space.visibility}
            onClick={saveAccess}
          >
            {savingAccess ? 'Saving…' : 'Save access'}
          </Button>
        </CardFooter>
      </Card>

      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="text-destructive">Danger zone</CardTitle>
          <CardDescription>These actions affect everyone in the space.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-medium">{archived ? 'Restore space' : 'Archive space'}</div>
              <p className="text-muted-foreground text-xs">
                {archived
                  ? 'Make the space active and editable again.'
                  : 'Archived spaces are read-only and hidden from the default list. You can restore them.'}
              </p>
            </div>
            {archived ? (
              <Button variant="outline" disabled={busy} onClick={() => setStatus('restore')}>
                Restore
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setConfirmArchive(true)}>
                <Archive /> Archive
              </Button>
            )}
          </div>
          {space.permissions.delete && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <div>
                <div className="font-medium">Delete space</div>
                <p className="text-muted-foreground text-xs">
                  Removes the space for everyone. Its key can never be used again.
                </p>
              </div>
              <Button
                variant="destructive"
                onClick={() => {
                  setTyped('');
                  setConfirmDelete(true);
                }}
              >
                <Trash2 /> Delete
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirmArchive} onOpenChange={setConfirmArchive}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive “{space.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              It becomes read-only and leaves the default list. You can restore it at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button disabled={busy} onClick={() => setStatus('archive')}>
              Archive space
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{space.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. Type the key{' '}
              <span className="font-mono font-semibold">{space.key}</span> to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-key">Space key</Label>
            <Input
              id="confirm-key"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={busy || typed.toUpperCase() !== space.key}
              onClick={remove}
            >
              Delete space
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
