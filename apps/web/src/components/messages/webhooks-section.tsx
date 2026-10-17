'use client';

import { useState } from 'react';
import { Check, Copy, Plus, Webhook } from 'lucide-react';
import { toast } from '@/lib/toast';
import { MAX_WEBHOOKS_PER_CHANNEL } from '@crew-deck/shared';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { useCreateWebhook, useRevokeWebhook, useWebhooks } from '@/lib/messaging-admin-api';

const fail = (e: unknown, fallback: string) =>
  toast.error(e instanceof ApiError ? e.message : fallback);

/**
 * Incoming webhooks for a channel (owners and admins). The secret address is shown once, when it is made,
 * and never again: only its hash is kept.
 */
export function WebhooksSection({ channelId, archived }: { channelId: string; archived: boolean }) {
  const hooks = useWebhooks(channelId, true);
  const create = useCreateWebhook(channelId);
  const revoke = useRevokeWebhook(channelId);
  const [name, setName] = useState('');
  const [made, setMade] = useState<{ name: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [toRevoke, setToRevoke] = useState<{ id: string; name: string } | null>(null);
  if (hooks.isError) return null; // not allowed here (a direct message, say)
  const list = hooks.data ?? [];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    create.mutate(n, {
      onSuccess: ({ webhook, token }) => {
        setName('');
        setCopied(false);
        setMade({ name: webhook.name, url: `${window.location.origin}/api/v1/hooks/${token}` });
      },
      onError: (e) => fail(e, 'Could not create the webhook'),
    });
  };

  return (
    <section className="space-y-2">
      <h3 className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase">
        <Webhook className="size-3.5" aria-hidden /> Incoming webhooks
      </h3>
      <p className="text-muted-foreground text-xs">
        A secret address that lets another tool post text into this channel.
      </p>
      {list.length > 0 && (
        <ul className="divide-y rounded-lg border" aria-label="Webhooks">
          {list.map((h) => (
            <li key={h.id} className="flex items-center gap-2 px-2.5 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{h.name}</span>
                <span className="text-muted-foreground block text-xs">
                  {h.lastUsedAt
                    ? `Last used ${new Date(h.lastUsedAt).toLocaleDateString([], { day: 'numeric', month: 'short' })}`
                    : 'Never used'}
                </span>
              </span>
              <Button variant="ghost" size="xs" onClick={() => setToRevoke({ id: h.id, name: h.name })}>
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
      {!archived && list.length < MAX_WEBHOOKS_PER_CHANNEL && (
        <form className="flex gap-2" onSubmit={submit}>
          <Label htmlFor="hook-name" className="sr-only">
            Webhook name
          </Label>
          <Input
            id="hook-name"
            value={name}
            maxLength={60}
            placeholder="Name, for example Build server"
            onChange={(e) => setName(e.target.value)}
          />
          <Button type="submit" size="sm" variant="outline" loading={create.isPending} disabled={!name.trim()}>
            <Plus /> Add
          </Button>
        </form>
      )}

      <Dialog open={!!made} onOpenChange={(o) => !o && setMade(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Copy the address now</DialogTitle>
            <DialogDescription>
              This is the only time it is shown. Anyone with the address can post as “{made?.name}”
              here, so keep it secret. You can revoke it any time.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="hook-url">Webhook address</Label>
            <div className="flex gap-2">
              <Input id="hook-url" readOnly value={made?.url ?? ''} onFocus={(e) => e.currentTarget.select()} />
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  void navigator.clipboard
                    ?.writeText(made?.url ?? '')
                    .then(() => setCopied(true))
                    .catch(() => toast.error('Could not copy. Select the address and copy it.'))
                }
              >
                {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              Send a POST with JSON like <code>{'{"text": "Build passed"}'}</code>.
            </p>
          </div>
          <DialogFooter>
            <Button onClick={() => setMade(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!toRevoke} onOpenChange={(o) => !o && setToRevoke(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke “{toRevoke?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Its address stops working straight away. Messages it already posted stay.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-white"
              onClick={() =>
                toRevoke &&
                revoke.mutate(toRevoke.id, {
                  onSuccess: () => toast.success('Webhook revoked'),
                  onError: (e) => fail(e, 'Could not revoke it'),
                })
              }
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
