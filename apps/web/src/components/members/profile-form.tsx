'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { FormActions, FormRow, FormSection } from '@/components/ui/form-layout';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/shared/notice';
import { useFormFeedback } from '@/hooks/use-form-feedback';
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

  const { shakeKey, onInvalid } = useFormFeedback();

  const submit = handleSubmit(async (v) => {
    setError(null);
    try {
      await onSubmit(v);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save. Try again.');
    }
  }, onInvalid);

  const field = (id: keyof ProfileValues, label: string, hint?: string) => (
    <Field
      label={label}
      htmlFor={`pf-${id}`}
      error={errors[id]?.message}
      hint={hint}
      shakeKey={shakeKey}
    >
      <Input {...register(id)} />
    </Field>
  );

  return (
    <form onSubmit={submit} className="space-y-5" noValidate data-ready={ready || undefined}>
      {error && <Notice variant="error">{error}</Notice>}
      <FormSection title="Basics">
        <FormRow>
          {field('name', 'Full name')}
          {field('jobTitle', 'Job title')}
        </FormRow>
      </FormSection>
      <FormSection title="Preferences">
        {field('timezone', 'Timezone', 'Used to work out your day.')}
        {withAvatar &&
          field('avatarUrl', 'Avatar URL', 'Link to an image. Leave empty for initials.')}
      </FormSection>
      <FormActions>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" loading={isSubmitting} disabled={!isDirty}>
          {isSubmitting ? 'Saving…' : submitLabel}
        </Button>
      </FormActions>
    </form>
  );
}
