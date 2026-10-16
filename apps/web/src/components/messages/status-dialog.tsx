'use client';

import { useState } from 'react';
import { toast } from 'sonner';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import { useStatusMutations } from '@/lib/messaging-api';
import { EmojiPickerButton } from './emoji-picker';

const EXPIRY: { value: string; label: string; minutes: number | null }[] = [
  { value: 'never', label: 'Do not clear', minutes: null },
  { value: '30', label: '30 minutes', minutes: 30 },
  { value: '60', label: '1 hour', minutes: 60 },
  { value: '240', label: '4 hours', minutes: 240 },
  { value: 'today', label: 'Today', minutes: -1 },
  { value: '10080', label: 'This week', minutes: 10080 },
];

/** Sets (or clears) the custom status: an emoji, a few words, and when it goes away. */
export function StatusDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { status } = useStatusMutations();
  const [emoji, setEmoji] = useState('💬');
  const [text, setText] = useState('');
  const [expiry, setExpiry] = useState('never');

  const save = (clear: boolean) => {
    const choice = EXPIRY.find((e) => e.value === expiry)!;
    let expiresAt: string | null = null;
    if (!clear && choice.minutes !== null) {
      const at =
        choice.minutes === -1
          ? new Date(new Date().setHours(23, 59, 0, 0))
          : new Date(Date.now() + choice.minutes * 60_000);
      expiresAt = at.toISOString();
    }
    status.mutate(
      clear ? { emoji: null, text: null } : { emoji, text: text.trim() || null, expiresAt },
      {
        onSuccess: () => {
          toast.success(clear ? 'Status cleared' : 'Status updated');
          onOpenChange(false);
        },
        onError: (e) =>
          toast.error(e instanceof ApiError ? e.message : 'Could not update your status'),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Set a status</DialogTitle>
          <DialogDescription>
            Let people know what you are up to. It shows next to your name.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save(false);
          }}
        >
          <div className="flex items-center gap-2">
            <span
              className="flex size-9 items-center justify-center rounded-md border text-xl"
              aria-hidden
            >
              {emoji}
            </span>
            <EmojiPickerButton
              label="Choose an emoji"
              onPick={setEmoji}
              size="icon-sm"
              side="bottom"
            />
            <div className="flex-1">
              <Label htmlFor="status-text" className="sr-only">
                Status
              </Label>
              <Input
                id="status-text"
                autoFocus
                value={text}
                maxLength={100}
                onChange={(e) => setText(e.target.value)}
                placeholder="In a meeting, on holiday, focusing…"
              />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 text-sm">
            <Label htmlFor="status-expiry">Clear after</Label>
            <Select value={expiry} onValueChange={setExpiry}>
              <SelectTrigger id="status-expiry" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPIRY.map((e) => (
                  <SelectItem key={e.value} value={e.value}>
                    {e.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => save(true)}
              disabled={status.isPending}
            >
              Clear status
            </Button>
            <Button type="submit" loading={status.isPending} disabled={!text.trim()}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
