'use client';

import { useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  ChevronRight,
  Download,
  File as FileIcon,
  FileImage,
  Folder,
  FolderInput,
  FolderPlus,
  Loader2,
  MoreHorizontal,
  Pencil,
  Trash2,
  Upload,
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EmptyState } from '@/components/shared/empty-state';
import { LoadError } from '@/components/shared/load-error';
import { useSpace } from '@/components/spaces/space-context';
import { ApiError } from '@/lib/api';
import {
  uploadDocument,
  useDocMutations,
  useDocuments,
  useFolderTree,
  type DocFile,
  type DocFolder,
} from '@/lib/space-docs-api';
import { toastError } from '@/lib/work-api';
import { cn } from '@/lib/utils';
import { UserAvatar } from './work-bits';

const sizeText = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

type Target = { kind: 'folder'; item: DocFolder } | { kind: 'file'; item: DocFile };

/** The space's shared documents: nested folders and files, for everyone who can open the space. */
export function DocumentsView() {
  const space = useSpace();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const folder = params.get('folder');
  const docs = useDocuments(space.key, folder);
  const m = useDocMutations(space.key);
  const input = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<{ id: number; name: string; pct: number }[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [newFolder, setNewFolder] = useState(false);
  const [rename, setRename] = useState<Target | null>(null);
  const [move, setMove] = useState<Target | null>(null);
  const [remove, setRemove] = useState<Target | null>(null);

  const open = (id: string | null) => router.push(id ? `${pathname}?folder=${id}` : pathname);

  async function send(files: File[]) {
    for (const file of files) {
      const id = Math.random();
      setUploads((u) => [...u, { id, name: file.name, pct: 0 }]);
      try {
        await uploadDocument(space.key, folder, file, (pct) => setUploads((u) => u.map((x) => (x.id === id ? { ...x, pct } : x))));
      } catch (e) {
        toastError(e, `Could not upload ${file.name}`);
      } finally {
        setUploads((u) => u.filter((x) => x.id !== id));
        void docs.refetch();
      }
    }
  }

  if (docs.isError) {
    const missing = docs.error instanceof ApiError && docs.error.status === 404;
    return missing ? (
      <EmptyState
        title="Folder not found"
        description="It may have been deleted."
        action={
          <Button variant="outline" onClick={() => open(null)}>
            Back to documents
          </Button>
        }
      />
    ) : (
      <LoadError what="the documents" onRetry={() => void docs.refetch()} />
    );
  }
  if (!docs.data) return <p className="text-muted-foreground text-sm">Loading…</p>;
  const { path, folders, files, permissions, maxFileMb } = docs.data;
  const empty = folders.length === 0 && files.length === 0;

  return (
    <div
      className={cn('space-y-4 rounded-xl', dragOver && 'ring-primary ring-2 ring-offset-4')}
      onDragOver={(e) => {
        if (!permissions.add || !e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragOver(false)}
      onDrop={(e) => {
        if (!permissions.add) return;
        e.preventDefault();
        setDragOver(false);
        void send([...e.dataTransfer.files]);
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="Folder path" className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-sm">
          <button type="button" onClick={() => open(null)} className={cn('hover:underline', path.length === 0 ? 'font-semibold' : 'text-muted-foreground')}>
            Documents
          </button>
          {path.map((p, i) => (
            <span key={p.id} className="flex items-center gap-1">
              <ChevronRight className="text-muted-foreground size-3.5" aria-hidden />
              <button
                type="button"
                aria-current={i === path.length - 1 ? 'page' : undefined}
                onClick={() => open(p.id)}
                className={cn('hover:underline', i === path.length - 1 ? 'font-semibold' : 'text-muted-foreground')}
              >
                {p.name}
              </button>
            </span>
          ))}
        </nav>
        {permissions.add && (
          <>
            <Button variant="outline" size="sm" onClick={() => setNewFolder(true)}>
              <FolderPlus /> New folder
            </Button>
            <Button size="sm" onClick={() => input.current?.click()}>
              <Upload /> Upload
            </Button>
            <input
              ref={input}
              type="file"
              multiple
              className="sr-only"
              aria-label="Choose files to upload"
              tabIndex={-1}
              onChange={(e) => {
                void send([...(e.target.files ?? [])]);
                e.target.value = '';
              }}
            />
          </>
        )}
      </div>

      {uploads.length > 0 && (
        <ul className="space-y-1" aria-label="Uploading" aria-live="polite">
          {uploads.map((u) => (
            <li key={u.id} className="bg-muted/50 flex items-center gap-2 rounded-lg px-3 py-2 text-sm">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{u.name}</span>
              <span className="text-muted-foreground tabular-nums">{u.pct}%</span>
            </li>
          ))}
        </ul>
      )}

      {empty ? (
        <EmptyState
          icon={Folder}
          title={path.length ? 'This folder is empty' : 'No documents yet'}
          description={
            permissions.add
              ? `Drop files here, or use Upload. Files up to ${maxFileMb} MB. Everyone in the space can open them.`
              : 'Nothing has been shared in this space yet.'
          }
        />
      ) : (
        <div className="bg-card overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <caption className="sr-only">Folders and files{path.length ? ` in ${path[path.length - 1]!.name}` : ''}</caption>
            <thead className="text-muted-foreground border-b text-xs">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-medium">
                  Name
                </th>
                <th scope="col" className="hidden px-3 py-2 text-left font-medium sm:table-cell">
                  Added by
                </th>
                <th scope="col" className="hidden px-3 py-2 text-left font-medium md:table-cell">
                  Added
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Size
                </th>
                <th scope="col" className="w-10 px-3 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {folders.map((f) => (
                <tr key={f.id} className="hover:bg-muted/40">
                  <td className="px-3 py-2">
                    <button type="button" onClick={() => open(f.id)} className="flex w-full items-center gap-2 text-left font-medium hover:underline">
                      <Folder className="size-4 shrink-0 text-amber-600" aria-hidden />
                      <span className="truncate">{f.name}</span>
                    </button>
                  </td>
                  <td className="hidden px-3 py-2 sm:table-cell">
                    <Person person={f.createdBy} />
                  </td>
                  <td className="text-muted-foreground hidden px-3 py-2 md:table-cell">{when(f.createdAt)}</td>
                  <td className="text-muted-foreground px-3 py-2 text-right">—</td>
                  <td className="px-3 py-2">
                    <RowMenu
                      label={f.name}
                      canEdit={f.permissions.delete}
                      onRename={() => setRename({ kind: 'folder', item: f })}
                      onMove={() => setMove({ kind: 'folder', item: f })}
                      onDelete={() => setRemove({ kind: 'folder', item: f })}
                    />
                  </td>
                </tr>
              ))}
              {files.map((f) => (
                <tr key={f.id} className="hover:bg-muted/40">
                  <td className="px-3 py-2">
                    <a href={f.url} className="flex items-center gap-2 font-medium hover:underline" {...(f.isImage ? { target: '_blank', rel: 'noreferrer' } : { download: f.name })}>
                      {f.isImage ? <FileImage className="text-muted-foreground size-4 shrink-0" aria-hidden /> : <FileIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />}
                      <span className="truncate">{f.name}</span>
                    </a>
                  </td>
                  <td className="hidden px-3 py-2 sm:table-cell">
                    <Person person={f.uploader} />
                  </td>
                  <td className="text-muted-foreground hidden px-3 py-2 md:table-cell">{when(f.createdAt)}</td>
                  <td className="text-muted-foreground px-3 py-2 text-right tabular-nums">{sizeText(f.size)}</td>
                  <td className="px-3 py-2">
                    <RowMenu
                      label={f.name}
                      download={f.url}
                      canEdit={f.permissions.delete}
                      onRename={() => setRename({ kind: 'file', item: f })}
                      onMove={() => setMove({ kind: 'file', item: f })}
                      onDelete={() => setRemove({ kind: 'file', item: f })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {newFolder && (
        <NameDialog
          title="New folder"
          action="Create"
          initial=""
          onClose={() => setNewFolder(false)}
          save={(name) => m.createFolder.mutateAsync({ name, parentId: folder })}
        />
      )}
      {rename && (
        <NameDialog
          title={rename.kind === 'folder' ? 'Rename folder' : 'Rename file'}
          action="Save"
          initial={rename.item.name}
          onClose={() => setRename(null)}
          save={(name) =>
            rename.kind === 'folder' ? m.updateFolder.mutateAsync({ id: rename.item.id, name }) : m.updateFile.mutateAsync({ id: rename.item.id, name })
          }
        />
      )}
      {move && (
        <MoveDialog
          target={move}
          spaceKey={space.key}
          onClose={() => setMove(null)}
          save={(to) =>
            move.kind === 'folder' ? m.updateFolder.mutateAsync({ id: move.item.id, parentId: to }) : m.updateFile.mutateAsync({ id: move.item.id, folderId: to })
          }
        />
      )}

      <AlertDialog open={!!remove} onOpenChange={(o) => !o && setRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {remove?.item.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {remove?.kind === 'folder'
                ? 'The folder and everything inside it is deleted for everyone in the space. This cannot be undone.'
                : 'The file is deleted for everyone in the space. This cannot be undone.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const t = remove!;
                const run = t.kind === 'folder' ? m.deleteFolder.mutateAsync(t.item.id) : m.deleteFile.mutateAsync(t.item.id);
                run.then(
                  () => toast.success(`${t.item.name} deleted`),
                  (e) => toastError(e, 'Could not delete it'),
                );
                setRemove(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Person({ person }: { person: { name: string | null; email: string; id: string; avatarUrl: string | null } | null }) {
  if (!person) return <span className="text-muted-foreground">Someone</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <UserAvatar person={person} size={20} />
      <span className="truncate">{person.name ?? person.email}</span>
    </span>
  );
}

function RowMenu({
  label,
  download,
  canEdit,
  onRename,
  onMove,
  onDelete,
}: {
  label: string;
  download?: string;
  canEdit: boolean;
  onRename: () => void;
  onMove: () => void;
  onDelete: () => void;
}) {
  if (!download && !canEdit) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8" aria-label={`Actions for ${label}`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {download && (
          <DropdownMenuItem asChild>
            <a href={download} download={label}>
              <Download /> Download
            </a>
          </DropdownMenuItem>
        )}
        {canEdit && (
          <>
            <DropdownMenuItem onSelect={onRename}>
              <Pencil /> Rename
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onMove}>
              <FolderInput /> Move to…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NameDialog({
  title,
  action,
  initial,
  onClose,
  save,
}: {
  title: string;
  action: string;
  initial: string;
  onClose: () => void;
  save: (name: string) => Promise<unknown>;
}) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              await save(name.trim());
              onClose();
            } catch (err) {
              setError(err instanceof ApiError ? (err.fields?.name ?? err.message) : 'Could not save that');
            } finally {
              setBusy(false);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="sr-only">Enter a name</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="doc-name">Name</Label>
            <Input id="doc-name" autoFocus maxLength={180} value={name} aria-invalid={!!error} onChange={(e) => setName(e.target.value)} />
            {error && (
              <p role="alert" className="text-destructive text-xs">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || busy}>
              {action}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MoveDialog({
  target,
  spaceKey,
  onClose,
  save,
}: {
  target: Target;
  spaceKey: string;
  onClose: () => void;
  save: (to: string | null) => Promise<unknown>;
}) {
  const tree = useFolderTree(spaceKey, true);
  const [to, setTo] = useState('root');
  const [busy, setBusy] = useState(false);
  // A folder cannot move into itself or anything below it (the server checks too).
  const blocked = (label: string) =>
    target.kind === 'folder' && tree.data
      ? (() => {
          const self = tree.data.find((f) => f.id === target.item.id);
          return !!self && (label === self.label || label.startsWith(`${self.label} / `));
        })()
      : false;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Move {target.item.name}</DialogTitle>
          <DialogDescription>Choose where it should go.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="move-to">Folder</Label>
          <Select value={to} onValueChange={setTo}>
            <SelectTrigger id="move-to">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="root">Documents (top level)</SelectItem>
              {(tree.data ?? [])
                .filter((f) => !blocked(f.label))
                .map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.label}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || tree.isPending}
            onClick={async () => {
              setBusy(true);
              try {
                await save(to === 'root' ? null : to);
                onClose();
              } catch (err) {
                toastError(err, 'Could not move it');
              } finally {
                setBusy(false);
              }
            }}
          >
            Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
