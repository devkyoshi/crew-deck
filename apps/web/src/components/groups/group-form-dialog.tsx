'use client';

import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { z } from 'zod';
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
import { Field } from '@/components/ui/field';
import { useFormFeedback } from '@/hooks/use-form-feedback';
import { Textarea } from '@/components/ui/textarea';
import { api, ApiError, type GroupDetail } from '@/lib/api';

const schema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(60, 'Keep it under 60 characters'),
  description: z.string().trim().max(500, 'Keep it under 500 characters'),
});
type Values = z.infer<typeof schema>;

/** Create or edit a group. Pass `group` to edit. */
export function GroupFormDialog({
  group,
  trigger,
  onSaved,
}: {
  group?: { id: string; name: string; description: string | null };
  trigger: ReactNode;
  onSaved?: (g: GroupDetail) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: group?.name ?? '', description: group?.description ?? '' },
  });

  const { shakeKey, onInvalid } = useFormFeedback();

  const submit = handleSubmit(async (v) => {
    try {
      const saved = await api<GroupDetail>(group ? `/groups/${group.id}` : '/groups', {
        method: group ? 'PATCH' : 'POST',
        body: group ? { name: v.name, description: v.description } : v,
      });
      toast.success(group ? 'Group updated' : `Group “${saved.name}” created`);
      qc.invalidateQueries({ queryKey: ['groups'] });
      qc.invalidateQueries({ queryKey: ['group'] });
      onSaved?.(saved);
      setOpen(false);
      if (!group) reset({ name: '', description: '' });
    } catch (e) {
      if (e instanceof ApiError && e.fields?.name) setError('name', { message: e.fields.name });
      else toast.error(e instanceof ApiError ? e.message : 'Could not save the group');
    }
  }, onInvalid);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) reset({ name: group?.name ?? '', description: group?.description ?? '' });
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{group ? 'Edit group' : 'New group'}</DialogTitle>
          <DialogDescription>
            Groups are teams such as Backend, BA or QA. You can add people after creating it.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Name" htmlFor="group-name" error={errors.name?.message} shakeKey={shakeKey}>
            <Input {...register('name')} />
          </Field>
          <Field
            label="Description"
            htmlFor="group-desc"
            error={errors.description?.message}
            shakeKey={shakeKey}
          >
            <Textarea rows={3} {...register('description')} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting}>
              {isSubmitting ? 'Saving…' : group ? 'Save changes' : 'Create group'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
