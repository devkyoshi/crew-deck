'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';

const schema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(100),
  jobTitle: z.string().trim().max(100),
  timezone: z.string().refine((tz) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'Unknown timezone, for example Europe/London'),
  avatarUrl: z.string().trim().url('Enter a valid URL').or(z.literal('')),
});
export type ProfileValues = z.infer<typeof schema>;

export function ProfileForm({
  initial,
  withAvatar,
  submitLabel = 'Save changes',
  onSubmit,
  onCancel,
}: {
  initial: Partial<ProfileValues>;
  withAvatar?: boolean;
  submitLabel?: string;
  onSubmit: (v: ProfileValues) => Promise<void>;
  onCancel?: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  // Lets tests (and assistive tech hooks) know the form is interactive and its values are loaded.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<ProfileValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', jobTitle: '', timezone: 'UTC', avatarUrl: '', ...initial },
  });

  const submit = handleSubmit(async (v) => {
    setError(null);
    try {
      await onSubmit(v);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save. Try again.');
    }
  });

  const field = (id: keyof ProfileValues, label: string, hint?: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={`pf-${id}`}>{label}</Label>
      <Input id={`pf-${id}`} aria-invalid={!!errors[id]} {...register(id)} />
      {errors[id] ? (
        <p className="text-destructive text-xs">{errors[id]?.message}</p>
      ) : (
        hint && <p className="text-muted-foreground text-xs">{hint}</p>
      )}
    </div>
  );

  return (
    <form onSubmit={submit} className="space-y-4" noValidate data-ready={ready || undefined}>
      {error && (
        <div
          role="alert"
          className="border-destructive/30 bg-destructive/5 text-destructive rounded-xl border p-3 text-sm"
        >
          {error}
        </div>
      )}
      {field('name', 'Full name')}
      {field('jobTitle', 'Job title')}
      {field('timezone', 'Timezone', 'Used to work out your day.')}
      {withAvatar &&
        field('avatarUrl', 'Avatar URL', 'Link to an image. Leave empty for initials.')}
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={isSubmitting || !isDirty}>
          {isSubmitting ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </form>
  );
}
