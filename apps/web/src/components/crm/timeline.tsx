'use client';

import { Notice } from '@/components/shared/notice';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock,
  Mail,
  MessageSquarePlus,
  Phone,
  Trash2,
  Users as UsersIcon,
  CheckSquare,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState } from '@/components/shared/empty-state';
import { useMe } from '@/components/shell/me-context';
import { api, ApiError, qs, type Page } from '@/lib/api';
import {
  ACTIVITY_LABEL,
  useCrmAccess,
  type Activity,
  type ActivityType,
  type CrmRecordType,
  type Note,
} from '@/lib/crm';
import { timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { OwnerSelect } from './crm-bits';

const ICONS: Record<ActivityType, typeof Phone> = {
  call: Phone,
  meeting: UsersIcon,
  email: Mail,
  task: CheckSquare,
};

export function dueLabel(a: Activity) {
  if (a.completedAt) return `Done ${timeAgo(a.completedAt)}`;
  if (!a.dueAt) return 'No due date';
  const overdue = new Date(a.dueAt).getTime() < Date.now();
  return `${overdue ? 'Overdue · ' : 'Due '}${new Date(a.dueAt).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' })}`;
}

export function ActivityRow({
  a,
  canEdit,
  onChanged,
  footer,
}: {
  a: Activity;
  canEdit: boolean;
  onChanged: () => void;
  footer?: React.ReactNode;
}) {
  const me = useMe();
  const access = useCrmAccess().data;
  const Icon = ICONS[a.type];
  const overdue = !a.completedAt && a.dueAt && new Date(a.dueAt).getTime() < Date.now();
  const toggle = useMutation({
    mutationFn: (done: boolean) =>
      api(`/crm/activities/${a.id}/complete`, { method: 'POST', body: { done } }),
    onSuccess: onChanged,
    onError: (e) =>
      toast.error(e instanceof ApiError ? e.message : 'Could not update the activity'),
  });
  const remove = useMutation({
    mutationFn: () => api(`/crm/activities/${a.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Activity removed');
      onChanged();
    },
    onError: (e) =>
      toast.error(e instanceof ApiError ? e.message : 'Could not remove the activity'),
  });
  const mayDelete = canEdit && (a.assigneeId === me.user.id || access?.canAdmin);
  return (
    <li className="flex items-start gap-3 rounded-xl border p-3">
      <Checkbox
        checked={!!a.completedAt}
        disabled={!canEdit || toggle.isPending}
        onCheckedChange={(v) => toggle.mutate(!!v)}
        aria-label={`Mark “${a.subject}” as ${a.completedAt ? 'not done' : 'done'}`}
        className="mt-1"
      />
      <div className="min-w-0 flex-1">
        <p className={cn('font-medium', a.completedAt && 'text-muted-foreground line-through')}>
          <Icon className="mr-1.5 inline size-4 align-text-bottom" aria-hidden />
          <span className="sr-only">{ACTIVITY_LABEL[a.type]}: </span>
          {a.subject}
        </p>
        <p
          className={cn(
            'text-xs',
            overdue ? 'font-medium text-rose-700 dark:text-rose-300' : 'text-muted-foreground',
          )}
        >
          {dueLabel(a)}
          {a.assigneeName ? ` · ${a.assigneeName}` : ''}
        </p>
        {footer}
      </div>
      {mayDelete && (
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={`Delete “${a.subject}”`}
          disabled={remove.isPending}
          onClick={() => remove.mutate()}
        >
          <Trash2 className="size-4" aria-hidden />
        </Button>
      )}
    </li>
  );
}

/** Quick form to log a call, meeting, email or task against a record. */
export function ActivityForm({
  linkedType,
  linkedId,
  onDone,
}: {
  linkedType?: CrmRecordType;
  linkedId?: string;
  onDone: () => void;
}) {
  const me = useMe();
  const [type, setType] = useState<ActivityType>('task');
  const [subject, setSubject] = useState('');
  const [due, setDue] = useState('');
  const [assignee, setAssignee] = useState<string | null>(me.user.id);
  const [error, setError] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: () =>
      api('/crm/activities', {
        method: 'POST',
        body: {
          type,
          subject,
          dueAt: due ? new Date(due).toISOString() : null,
          assigneeId: assignee,
          linkedType: linkedType ?? null,
          linkedId: linkedId ?? null,
        },
      }),
    onSuccess: () => {
      setSubject('');
      setDue('');
      setError(null);
      toast.success('Activity added');
      onDone();
    },
    onError: (e) =>
      setError(
        e instanceof ApiError
          ? e.fields
            ? Object.values(e.fields)[0]!
            : e.message
          : 'Could not add the activity',
      ),
  });
  return (
    <form
      className="bg-muted/40 grid gap-3 rounded-2xl p-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!subject.trim()) return setError('Enter a subject');
        add.mutate();
      }}
      noValidate
    >
      <div className="space-y-1.5">
        <Label htmlFor="act-type">Type</Label>
        <Select value={type} onValueChange={(v) => setType(v as ActivityType)}>
          <SelectTrigger id="act-type" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(ACTIVITY_LABEL).map(([v, l]) => (
              <SelectItem key={v} value={v}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="act-subject">Subject</Label>
        <Input
          id="act-subject"
          value={subject}
          maxLength={200}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Follow up on the proposal"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="act-due">Due</Label>
        <Input
          id="act-due"
          type="datetime-local"
          value={due}
          onChange={(e) => setDue(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="act-assignee">Assigned to</Label>
        <OwnerSelect
          id="act-assignee"
          value={assignee}
          onChange={setAssignee}
          label="Assigned to"
        />
      </div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={add.isPending}>
          <CalendarClock className="size-4" aria-hidden />{' '}
          {add.isPending ? 'Adding…' : 'Add activity'}
        </Button>
        {error && <Notice variant="error">{error}</Notice>}
      </div>
    </form>
  );
}

function NotesPanel({
  linkedType,
  linkedId,
  canEdit,
}: {
  linkedType: CrmRecordType;
  linkedId: string;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const me = useMe();
  const access = useCrmAccess().data;
  const [body, setBody] = useState('');
  const key = ['crm', 'notes', linkedType, linkedId];
  const notes = useQuery({
    queryKey: key,
    queryFn: () => api<{ items: Note[] }>(`/crm/notes${qs({ linkedType, linkedId })}`),
  });
  const add = useMutation({
    mutationFn: () => api('/crm/notes', { method: 'POST', body: { body, linkedType, linkedId } }),
    onSuccess: () => {
      setBody('');
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not save the note'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/crm/notes/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not delete the note'),
  });
  return (
    <div className="space-y-4">
      {canEdit && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (body.trim()) add.mutate();
          }}
        >
          <Label htmlFor="note-body" className="sr-only">
            Note
          </Label>
          <Textarea
            id="note-body"
            rows={3}
            value={body}
            maxLength={5000}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write a note"
          />
          <Button type="submit" disabled={add.isPending || !body.trim()}>
            <MessageSquarePlus className="size-4" aria-hidden />{' '}
            {add.isPending ? 'Saving…' : 'Add note'}
          </Button>
        </form>
      )}
      {notes.isPending ? (
        <Skeleton role="status" aria-label="Loading notes" className="h-20 w-full rounded-xl" />
      ) : notes.data?.items.length === 0 ? (
        <EmptyState
          icon={MessageSquarePlus}
          title="No notes yet"
          description="Notes you add show up here for everyone with CRM access."
        />
      ) : (
        <ul className="space-y-2">
          {notes.data?.items.map((n) => (
            <li key={n.id} className="rounded-xl border p-3">
              <p className="whitespace-pre-wrap">{n.body}</p>
              <p className="text-muted-foreground mt-1 flex items-center justify-between text-xs">
                <span>
                  {n.authorName ?? 'Someone'} · {timeAgo(n.createdAt)}
                </span>
                {canEdit && (n.authorId === me.user.id || access?.canAdmin) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => remove.mutate(n.id)}
                    aria-label="Delete note"
                  >
                    Delete
                  </Button>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Activities and notes for one record, in tabs. */
export function Timeline({
  linkedType,
  linkedId,
}: {
  linkedType: CrmRecordType;
  linkedId: string;
}) {
  const qc = useQueryClient();
  const canEdit = useCrmAccess().data?.canEdit ?? false;
  const key = ['crm', 'activities', linkedType, linkedId];
  const acts = useQuery({
    queryKey: key,
    queryFn: () =>
      api<Page<Activity>>(`/crm/activities${qs({ linkedType, linkedId, pageSize: 100 })}`),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['crm'] });
  return (
    <Tabs defaultValue="activity">
      <TabsList>
        <TabsTrigger value="activity">Activity</TabsTrigger>
        <TabsTrigger value="notes">Notes</TabsTrigger>
      </TabsList>
      <TabsContent value="activity" className="space-y-4 pt-2">
        {canEdit && <ActivityForm linkedType={linkedType} linkedId={linkedId} onDone={refresh} />}
        {acts.isPending ? (
          <Skeleton
            role="status"
            aria-label="Loading activity"
            className="h-20 w-full rounded-xl"
          />
        ) : acts.data?.items.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="No activity yet"
            description="Log a call, meeting, email or task to keep track of what happens next."
          />
        ) : (
          <ul className="space-y-2">
            {acts.data?.items.map((a) => (
              <ActivityRow key={a.id} a={a} canEdit={canEdit} onChanged={refresh} />
            ))}
          </ul>
        )}
      </TabsContent>
      <TabsContent value="notes" className="pt-2">
        <NotesPanel linkedType={linkedType} linkedId={linkedId} canEdit={canEdit} />
      </TabsContent>
    </Tabs>
  );
}
