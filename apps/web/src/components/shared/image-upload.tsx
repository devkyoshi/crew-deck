'use client';

import { useRef, useState, type ReactNode } from 'react';
import { Camera, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const ACCEPT = 'image/png,image/jpeg,image/webp';
const MAX_BYTES = 2 * 1024 * 1024;

/** Sends one picture as multipart/form-data and returns what the server saved. */
async function send(path: string, file: File) {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`/api/v1${path}`, { method: 'POST', body: form, credentials: 'same-origin' });
  const data = (await res.json().catch(() => null)) as { message?: string; fields?: Record<string, string> } | null;
  if (!res.ok) throw new Error(data?.fields?.file ?? data?.message ?? 'Could not upload that picture.');
  return data as Record<string, string>;
}

/**
 * A picture with "Upload" and "Remove" beside it: the profile photo (round) and the workspace logo
 * (rounded square). `preview` is what is shown now; `onChanged` runs after the server has saved.
 */
export function ImageUpload({
  endpoint,
  removeEndpoint,
  preview,
  shape = 'round',
  size = 96,
  label,
  hint,
  fallback,
  onChanged,
}: {
  endpoint: string;
  removeEndpoint?: string;
  preview: string | null;
  shape?: 'round' | 'square';
  size?: number;
  label: string;
  hint?: string;
  fallback: ReactNode;
  onChanged: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState<string | null>(null);
  const shown = local ?? preview;

  async function pick(file: File | undefined) {
    if (!file) return;
    if (!ACCEPT.split(',').includes(file.type)) {
      toast.error('Use a PNG, JPG or WebP picture.');
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error('Pictures can be up to 2 MB.');
      return;
    }
    setBusy(true);
    setLocal(URL.createObjectURL(file));
    try {
      await send(endpoint, file);
      toast.success(`${label} updated`);
      onChanged();
    } catch (e) {
      setLocal(null);
      toast.error(e instanceof Error ? e.message : 'Could not upload that picture.');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  async function remove() {
    if (!removeEndpoint) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1${removeEndpoint}`, { method: 'DELETE', credentials: 'same-origin' });
      if (!res.ok) throw new Error();
      setLocal(null);
      toast.success(`${label} removed`);
      onChanged();
    } catch {
      toast.error('Could not remove it. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-5">
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        aria-label={`Change ${label.toLowerCase()}`}
        style={{ width: size, height: size }}
        className={cn(
          'group bg-muted relative shrink-0 overflow-hidden border outline-none focus-visible:ring-2 focus-visible:ring-ring',
          shape === 'round' ? 'rounded-full' : 'rounded-xl',
        )}
      >
        {shown ? (
          <img src={shown} alt="" className="size-full object-cover" />
        ) : (
          <span className="text-muted-foreground flex size-full items-center justify-center text-xl font-semibold">
            {fallback}
          </span>
        )}
        <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">
          {busy ? <Loader2 className="size-5 animate-spin" /> : <Camera className="size-5" />}
        </span>
      </button>
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => input.current?.click()} disabled={busy}>
            <Camera /> {shown ? 'Change' : 'Upload'}
          </Button>
          {shown && removeEndpoint && (
            <Button type="button" size="sm" variant="ghost" onClick={remove} disabled={busy}>
              <Trash2 /> Remove
            </Button>
          )}
        </div>
        <p className="text-muted-foreground text-xs">{hint ?? 'PNG, JPG or WebP, up to 2 MB.'}</p>
      </div>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-label={`${label} file`}
        onChange={(e) => void pick(e.target.files?.[0])}
      />
    </div>
  );
}
