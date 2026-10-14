'use client';

import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import type { Tag } from '@/lib/crm';
import { CompanyPicker, OwnerSelect, TagPicker } from './crm-bits';

export type FieldDef =
  | {
      key: string;
      label: string;
      type: 'text' | 'email' | 'tel' | 'date';
      required?: boolean;
      max?: number;
      placeholder?: string;
    }
  | { key: string; label: string; type: 'number'; required?: boolean; min?: number }
  | {
      key: string;
      label: string;
      type: 'select';
      options: { value: string; label: string }[];
      required?: boolean;
    }
  | { key: string; label: string; type: 'owner' }
  | { key: string; label: string; type: 'company'; labelKey: string }
  | { key: string; label: string; type: 'tags' };

export type Values = Record<string, unknown>;

/** A form dialog driven by a field list. Server-side field errors are shown beside the field. */
export function RecordDialog({
  title,
  description,
  fields,
  initial,
  submitLabel,
  trigger,
  onSubmit,
  successMessage,
}: {
  title: string;
  description?: string;
  fields: FieldDef[];
  initial: Values;
  submitLabel: string;
  trigger: ReactNode;
  onSubmit: (values: Values) => Promise<unknown>;
  successMessage: string;
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Values>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (key: string, v: unknown) => setValues((s) => ({ ...s, [key]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const local: Record<string, string> = {};
    for (const f of fields) {
      if ('required' in f && f.required) {
        const v = values[f.key];
        if (v === undefined || v === null || String(v).trim() === '')
          local[f.key] = `Enter ${f.label.toLowerCase()}`;
      }
    }
    setErrors(local);
    if (Object.keys(local).length) return;
    setBusy(true);
    try {
      await onSubmit(values);
      toast.success(successMessage);
      setOpen(false);
    } catch (err) {
      if (err instanceof ApiError && err.fields && Object.keys(err.fields).length)
        setErrors(err.fields);
      else toast.error(err instanceof ApiError ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setValues(initial);
          setErrors({});
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description ?? 'Fields marked * are required.'}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          {fields.map((f) => {
            const id = `rf-${f.key}`;
            const err = errors[f.key];
            const label = 'required' in f && f.required ? `${f.label} *` : f.label;
            return (
              <div key={f.key} className="space-y-1.5">
                <Label htmlFor={id}>{label}</Label>
                {(f.type === 'text' ||
                  f.type === 'email' ||
                  f.type === 'tel' ||
                  f.type === 'date') && (
                  <Input
                    id={id}
                    type={f.type}
                    maxLength={f.type === 'text' ? (f.max ?? 160) : undefined}
                    placeholder={f.placeholder}
                    aria-invalid={!!err}
                    value={(values[f.key] as string | null | undefined) ?? ''}
                    onChange={(e) => set(f.key, e.target.value)}
                  />
                )}
                {f.type === 'number' && (
                  <Input
                    id={id}
                    type="number"
                    min={f.min ?? 0}
                    step="any"
                    inputMode="decimal"
                    aria-invalid={!!err}
                    value={(values[f.key] as number | string | undefined) ?? ''}
                    onChange={(e) =>
                      set(f.key, e.target.value === '' ? '' : Number(e.target.value))
                    }
                  />
                )}
                {f.type === 'select' && (
                  <Select
                    value={(values[f.key] as string) ?? ''}
                    onValueChange={(v) => set(f.key, v)}
                  >
                    <SelectTrigger id={id} className="w-full" aria-invalid={!!err}>
                      <SelectValue placeholder="Choose" />
                    </SelectTrigger>
                    <SelectContent>
                      {f.options.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {f.type === 'owner' && (
                  <OwnerSelect
                    id={id}
                    value={values[f.key] as string | null}
                    onChange={(v) => set(f.key, v)}
                  />
                )}
                {f.type === 'company' && (
                  <CompanyPicker
                    id={id}
                    value={values[f.key] as string | null}
                    label={(values[f.labelKey] as string | null) ?? null}
                    onChange={(c) =>
                      setValues((s) => ({
                        ...s,
                        [f.key]: c?.id ?? null,
                        [f.labelKey]: c?.name ?? null,
                      }))
                    }
                  />
                )}
                {f.type === 'tags' && (
                  <TagPicker
                    value={(values[f.key] as Tag[]) ?? []}
                    onChange={(t) => set(f.key, t)}
                  />
                )}
                {err && (
                  <p role="alert" className="text-destructive text-xs">
                    {err}
                  </p>
                )}
              </div>
            );
          })}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Turns dialog values into an API body: empty strings become null, tag objects become ids. */
export function toBody(values: Values, keys: string[]): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const k of keys) {
    const v = values[k];
    if (k === 'tagIds') continue;
    if (k === 'value') {
      body.value = typeof v === 'number' ? v : 0;
      continue;
    }
    if (k === 'tags') {
      body.tagIds = ((v as Tag[] | undefined) ?? []).map((t) => t.id);
      continue;
    }
    body[k] = v === '' || v === undefined ? null : v;
  }
  return body;
}
