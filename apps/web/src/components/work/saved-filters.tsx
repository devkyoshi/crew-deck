'use client';

import { useState } from 'react';
import { Bookmark, BookmarkPlus, Lock, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toastError } from '@/lib/work-api';
import { useDeleteFilter, useSaveFilter, useSavedFilters } from '@/lib/work-find-api';

/**
 * Saved views of the board or list: the filter part of the URL under a name. Personal filters are for
 * everyone; sharing with the space needs a member role and the plan's shared filters feature.
 */
export function SavedFilters({
  spaceKey,
  spaceId,
  current,
  onApply,
}: {
  spaceKey: string;
  spaceId: string;
  /** The current filter string ("type=bug&mine=1"). */
  current: string;
  onApply: (query: string) => void;
}) {
  const filters = useSavedFilters(spaceKey);
  const save = useSaveFilter();
  const del = useDeleteFilter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const items = filters.data?.items ?? [];
  const canShare = !!filters.data?.canShare;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-8">
            <Bookmark /> Saved
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>Saved filters</DropdownMenuLabel>
          {items.length === 0 && <p className="text-muted-foreground px-2 py-1.5 text-sm">None yet</p>}
          {items.map((f) => (
            <DropdownMenuItem key={f.id} onSelect={() => onApply(f.query)} className="group">
              {f.shared ? <Users aria-label="Shared" /> : <Bookmark aria-hidden />}
              <span className="flex-1 truncate">{f.name}</span>
              {f.canEdit && (
                <button
                  type="button"
                  aria-label={`Delete ${f.name}`}
                  className="text-muted-foreground hover:text-destructive rounded-sm p-0.5"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    del.mutate(f.id, { onError: (err) => toastError(err, 'Could not delete it') });
                  }}
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!current} onSelect={() => setOpen(true)}>
            <BookmarkPlus /> Save current filters…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save these filters</DialogTitle>
            <DialogDescription>Come back to this view from the Saved menu on the board and the list.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(
                { name: name.trim(), query: current, spaceId, shared },
                {
                  onSuccess: () => {
                    toast.success('Filter saved');
                    setOpen(false);
                    setName('');
                    setShared(false);
                  },
                  onError: (err) => toastError(err, 'Could not save it'),
                },
              );
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="filter-name">Name</Label>
              <Input id="filter-name" autoFocus maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={shared} disabled={!canShare} onCheckedChange={(v) => setShared(v === true)} />
              Share with everyone in this space
              {!canShare && (
                <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                  <Lock className="size-3" aria-hidden /> Upgrade to share
                </span>
              )}
            </label>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!name.trim() || save.isPending}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
