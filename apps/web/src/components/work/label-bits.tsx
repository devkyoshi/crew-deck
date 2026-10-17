'use client';

import { useState } from 'react';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { LABEL_CHIP, type Label } from '@/lib/work';
import { toastError, useCreateLabel, useLabels } from '@/lib/work-api';
import { cn } from '@/lib/utils';

export function LabelChip({
  label,
  className,
}: {
  label: Pick<Label, 'name' | 'color'>;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center rounded-sm px-1.5 py-0.5 text-xs leading-none font-medium',
        LABEL_CHIP[label.color] ?? LABEL_CHIP.slate,
        className,
      )}
    >
      <span className="truncate">{label.name}</span>
    </span>
  );
}

/** Up to two chips and a "+N" for the rest, for cards. */
export function LabelChips({ labels, max = 2 }: { labels: Pick<Label, 'id' | 'name' | 'color'>[]; max?: number }) {
  if (!labels.length) return null;
  const shown = labels.slice(0, max);
  const rest = labels.length - shown.length;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {shown.map((l) => (
        <LabelChip key={l.id} label={l} className="max-w-[7rem]" />
      ))}
      {rest > 0 && (
        <span className="text-muted-foreground text-xs font-medium" title={labels.slice(max).map((l) => l.name).join(', ')}>
          +{rest}
          <span className="sr-only"> more labels</span>
        </span>
      )}
    </div>
  );
}

/**
 * Pick any number of labels from the space, and create a new one by typing its name. Members can
 * create labels; the server decides, and a refusal shows as a message.
 */
export function LabelPicker({
  space,
  value,
  onChange,
  disabled,
  id,
  mode = 'set',
}: {
  space: string;
  value: Pick<Label, 'id' | 'name' | 'color'>[];
  onChange: (labels: Label[]) => void;
  disabled?: boolean;
  id?: string;
  /** `set` edits the selection; `pick` is a plain menu that reports one label at a time. */
  mode?: 'set' | 'pick';
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const labels = useLabels(space);
  const create = useCreateLabel(space);
  const all = labels.data?.items ?? [];
  const chosen = new Set(value.map((l) => l.id));
  const typed = q.trim();
  const exists = all.some((l) => l.name.toLowerCase() === typed.toLowerCase());

  async function createNew() {
    try {
      const made = await create.mutateAsync({ name: typed });
      onChange([...all.filter((l) => chosen.has(l.id)), made]);
      setQ('');
    } catch (e) {
      toastError(e, 'Could not create the label');
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="h-auto min-h-8 w-full justify-between py-1 font-normal"
        >
          <span className="flex min-w-0 flex-wrap gap-1">
            {value.length ? (
              value.map((l) => <LabelChip key={l.id} label={l} />)
            ) : (
              <span className="text-muted-foreground">{mode === 'pick' ? 'Labels' : 'No labels'}</span>
            )}
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Find or create a label" value={q} onValueChange={setQ} />
          <CommandList>
            {labels.isPending && <p className="text-muted-foreground p-3 text-xs">Loading…</p>}
            {labels.isSuccess && all.length === 0 && !typed && (
              <p className="text-muted-foreground p-3 text-xs">No labels yet. Type a name to create one.</p>
            )}
            <CommandGroup>
              {all
                .filter((l) => !typed || l.name.toLowerCase().includes(typed.toLowerCase()))
                .map((l) => (
                  <CommandItem
                    key={l.id}
                    value={l.id}
                    onSelect={() =>
                      onChange(
                        chosen.has(l.id)
                          ? all.filter((x) => chosen.has(x.id) && x.id !== l.id)
                          : [...all.filter((x) => chosen.has(x.id)), l],
                      )
                    }
                  >
                    <LabelChip label={l} />
                    {chosen.has(l.id) && <Check className="ml-auto size-4" aria-hidden />}
                  </CommandItem>
                ))}
              {typed && !exists && (
                <CommandItem value="__create" onSelect={createNew} disabled={create.isPending}>
                  <Plus aria-hidden /> Create “{typed}”
                </CommandItem>
              )}
            </CommandGroup>
            {typed && exists && all.every((l) => !l.name.toLowerCase().includes(typed.toLowerCase())) && (
              <CommandEmpty>No matches.</CommandEmpty>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
