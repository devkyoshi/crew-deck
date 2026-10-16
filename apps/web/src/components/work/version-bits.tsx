'use client';

import { useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useComponents, useVersions } from '@/lib/versions-api';
import { cn } from '@/lib/utils';

interface Option {
  id: string;
  name: string;
  hint?: string;
}

/** A small multi-select for versions and components: pick any number, shown as chips on the button. */
function OptionPicker({
  id,
  options,
  value,
  onChange,
  disabled,
  empty,
  none,
  label,
}: {
  id?: string;
  options: Option[];
  value: { id: string; name: string }[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  empty: string;
  none: string;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const chosen = new Set(value.map((v) => v.id));
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
          aria-label={label}
          disabled={disabled}
          className="h-auto min-h-8 w-full justify-between py-1 font-normal"
        >
          <span className="flex min-w-0 flex-wrap gap-1">
            {value.length ? (
              value.map((v) => (
                <span key={v.id} className="bg-muted rounded px-1.5 py-0.5 text-xs">
                  {v.name}
                </span>
              ))
            ) : (
              <span className="text-muted-foreground">{none}</span>
            )}
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search" />
          <CommandList>
            <CommandEmpty>{empty}</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.id}
                  value={`${o.name} ${o.id}`}
                  onSelect={() => onChange(chosen.has(o.id) ? [...chosen].filter((x) => x !== o.id) : [...chosen, o.id])}
                >
                  <Check className={cn('size-4', chosen.has(o.id) ? 'opacity-100' : 'opacity-0')} aria-hidden />
                  <span className="truncate">{o.name}</span>
                  {o.hint && <span className="text-muted-foreground ml-auto text-xs">{o.hint}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Released and archived versions are not offered for new work, but stay visible once chosen. */
export function VersionPicker({
  space,
  value,
  onChange,
  disabled,
  id,
  label,
  none = 'None',
}: {
  space: string;
  value: { id: string; name: string }[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  id?: string;
  label: string;
  none?: string;
}) {
  const versions = useVersions(space);
  const keep = new Set(value.map((v) => v.id));
  const options = (versions.data?.items ?? [])
    .filter((v) => v.state === 'unreleased' || keep.has(v.id))
    .map((v) => ({ id: v.id, name: v.name, hint: v.state === 'unreleased' ? undefined : v.state }));
  return (
    <OptionPicker
      id={id}
      options={options}
      value={value}
      onChange={onChange}
      disabled={disabled}
      empty="No versions yet. Add one on the Releases tab."
      none={none}
      label={label}
    />
  );
}

export function ComponentPicker({
  space,
  value,
  onChange,
  disabled,
  id,
}: {
  space: string;
  value: { id: string; name: string }[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  id?: string;
}) {
  const components = useComponents(space);
  return (
    <OptionPicker
      id={id}
      options={(components.data?.items ?? []).map((c) => ({ id: c.id, name: c.name }))}
      value={value}
      onChange={onChange}
      disabled={disabled}
      empty="No components yet. A space admin adds them on the Releases tab."
      none="None"
      label="Components"
    />
  );
}
