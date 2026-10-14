'use client';

import { useHasFeature } from '@/lib/plans';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { Globe, Kanban, Lock, Timer, Users } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import { DEFAULT_STATUSES, WORKSPACE_TEMPLATES, isWorkType } from '@crew-deck/shared';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Stepper } from '@/components/shared/stepper';
import {
  GroupLabel,
  GroupPicker,
  PeoplePicker,
  PersonLabel,
  type PickedGroup,
  type PickedPerson,
} from '@/components/shared/pickers';
import { useMe } from '@/components/shell/me-context';
import { api, ApiError, type SpaceDetail, type SpaceRole, type SpaceVisibility } from '@/lib/api';
import { SPACE_ICONS, spaceIcon, suggestKey } from '@/lib/space-icons';
import { cn } from '@/lib/utils';
import { SpaceIcon, VisibilityPill } from './space-bits';

const STEPS = ['Basics', 'Visibility', 'Access', 'Review'];

const schema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(80, 'Keep it under 80 characters'),
  key: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9]{1,9}$/, 'Use 2 to 10 letters or digits, starting with a letter'),
  icon: z.string(),
  description: z.string().trim().max(1000, 'Keep it under 1000 characters'),
  visibility: z.enum(['open', 'private']),
  boardType: z.enum(['kanban', 'scrum']),
});
type Values = z.infer<typeof schema>;

export function CreateSpaceWizard() {
  const router = useRouter();
  const qc = useQueryClient();
  const me = useMe();
  // New spaces start with the columns that fit the kind of work this workspace does.
  const startingColumns = (
    isWorkType(me.org.workType) ? WORKSPACE_TEMPLATES[me.org.workType].statuses : DEFAULT_STATUSES
  )
    .map((s) => s.name)
    .join(' → ');
  const [step, setStep] = useState(0);
  const [keyTouched, setKeyTouched] = useState(false);
  const [people, setPeople] = useState<PickedPerson[]>([]);
  const [groupsSel, setGroupsSel] = useState<PickedGroup[]>([]);
  const [roles, setRoles] = useState<Record<string, SpaceRole>>({});
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    watch,
    setValue,
    trigger,
    getValues,
    setError,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', key: '', icon: 'folder', description: '', visibility: 'open', boardType: 'kanban' },
  });
  const v = watch();
  const roleOf = (id: string) => roles[id] ?? 'member';
  const others = people.filter((p) => p.id !== me.user.id);

  async function next() {
    if (step === 0 && !(await trigger(['name', 'key', 'description']))) return;
    setStep((s) => s + 1);
  }

  async function create() {
    setSubmitting(true);
    const values = getValues();
    try {
      const space = await api<SpaceDetail>('/spaces', {
        body: {
          key: values.key.toUpperCase(),
          name: values.name,
          description: values.description || undefined,
          icon: values.icon,
          visibility: values.visibility,
          boardType: values.boardType,
          members: [
            ...others.map((p) => ({ type: 'user', id: p.id, role: roleOf(p.id) })),
            ...groupsSel.map((g) => ({ type: 'group', id: g.id, role: roleOf(g.id) })),
          ],
        },
      });
      toast.success(`Space “${space.name}” created`);
      qc.invalidateQueries({ queryKey: ['spaces'] });
      router.push(`/spaces/${space.key}`);
    } catch (e) {
      setSubmitting(false);
      if (e instanceof ApiError && e.fields?.key) {
        setError('key', { message: e.fields.key });
        setStep(0);
      } else {
        toast.error(e instanceof ApiError ? e.message : 'Could not create the space');
      }
    }
  }

  const scrumAllowed = useHasFeature('scrum_sprints');
  const nameReg = register('name');

  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader className="gap-4">
        <Stepper steps={STEPS} current={step} />
        <div>
          <CardTitle>{STEPS[step]}</CardTitle>
          <CardDescription>
            {
              [
                'Name your space and pick how it looks.',
                'Choose who can find and open it.',
                'Add people and groups, and decide what each can do.',
                'Check everything, then create the space.',
              ][step]
            }
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {step === 0 && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="space-name">Name</Label>
              <Input
                id="space-name"
                autoFocus
                placeholder="Product Launch"
                aria-invalid={!!errors.name}
                {...nameReg}
                onChange={(e) => {
                  nameReg.onChange(e);
                  if (!keyTouched)
                    setValue('key', suggestKey(e.target.value), { shouldValidate: false });
                }}
              />
              {errors.name && <p className="text-destructive text-xs">{errors.name.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="space-key">Key</Label>
              <Input
                id="space-key"
                className="max-w-40 font-mono uppercase"
                placeholder="PL"
                maxLength={10}
                aria-invalid={!!errors.key}
                {...register('key', { onChange: () => setKeyTouched(true) })}
              />
              {errors.key ? (
                <p className="text-destructive text-xs">{errors.key.message}</p>
              ) : (
                <p className="text-muted-foreground text-xs">
                  A short unique code. It cannot be changed or reused, even after the space is
                  deleted.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Icon</Label>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Icon">
                {Object.keys(SPACE_ICONS).map((name) => {
                  const Icon = spaceIcon(name);
                  const on = v.icon === name;
                  return (
                    <button
                      key={name}
                      type="button"
                      aria-pressed={on}
                      aria-label={name}
                      onClick={() => setValue('icon', name)}
                      className={cn(
                        'hover:bg-accent flex size-10 items-center justify-center rounded-xl border transition-colors',
                        on &&
                          'border-primary bg-accent text-accent-foreground ring-primary/30 ring-2',
                      )}
                    >
                      <Icon className="size-5" aria-hidden />
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="space-desc">Description</Label>
              <Textarea
                id="space-desc"
                rows={3}
                placeholder="What is this space for?"
                {...register('description')}
              />
              {errors.description && (
                <p className="text-destructive text-xs">{errors.description.message}</p>
              )}
            </div>
          </>
        )}

        {step === 1 && (
          <div className="grid gap-3 sm:grid-cols-2" role="group" aria-label="Visibility">
            {(
              [
                {
                  id: 'open',
                  icon: Globe,
                  title: 'Open',
                  text: 'Everyone in the workspace can find and view it.',
                },
                {
                  id: 'private',
                  icon: Lock,
                  title: 'Private',
                  text: 'Only people and groups you add (and workspace admins) can see it.',
                },
              ] as { id: SpaceVisibility; icon: typeof Globe; title: string; text: string }[]
            ).map((o) => {
              const on = v.visibility === o.id;
              return (
                <button
                  key={o.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setValue('visibility', o.id)}
                  className={cn(
                    'hover:bg-accent/60 space-y-2 rounded-2xl border p-4 text-left transition-colors',
                    on && 'border-primary bg-accent ring-primary/30 ring-2',
                  )}
                >
                  <o.icon className="text-primary size-5" aria-hidden />
                  <div className="font-medium">{o.title}</div>
                  <p className="text-muted-foreground text-xs">{o.text}</p>
                </button>
              );
            })}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-2" role="group" aria-label="Board type">
            <h3 className="text-sm font-medium">Board type</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                aria-pressed={v.boardType === 'kanban'}
                onClick={() => setValue('boardType', 'kanban')}
                className={cn(
                  'hover:bg-accent/60 space-y-2 rounded-2xl border p-4 text-left transition-colors',
                  v.boardType === 'kanban' && 'border-primary bg-accent ring-primary/30 ring-2',
                )}
              >
                <Kanban className="text-primary size-5" aria-hidden />
                <div className="font-medium">Kanban</div>
                <p className="text-muted-foreground text-xs">
                  Continuous flow. Work moves across columns as it progresses.
                </p>
                <p className="text-muted-foreground text-[11px]" data-testid="starting-columns">
                  Starts with: {startingColumns}
                </p>
              </button>
              <button
                type="button"
                aria-pressed={v.boardType === 'scrum'}
                disabled={!scrumAllowed}
                onClick={() => setValue('boardType', 'scrum')}
                className={cn(
                  'hover:bg-accent/60 space-y-2 rounded-2xl border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                  v.boardType === 'scrum' && 'border-primary bg-accent ring-primary/30 ring-2',
                )}
              >
                <Timer className="text-primary size-5" aria-hidden />
                <div className="flex items-center gap-2 font-medium">
                  Scrum
                  {!scrumAllowed && (
                    <span className="bg-secondary inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]">
                      <Lock className="size-3" aria-hidden /> Team plan
                    </span>
                  )}
                </div>
                <p className="text-muted-foreground text-xs">
                  A backlog and sprints with start and end dates, plus sprint reports.
                </p>
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <>
            <div className="bg-muted/50 flex items-center justify-between rounded-xl p-3 text-sm">
              <PersonLabel
                person={{
                  id: me.user.id,
                  name: me.user.name,
                  email: me.user.email,
                  avatarUrl: me.user.avatarUrl,
                }}
              />
              <span className="text-muted-foreground text-xs">You: admin (creator)</span>
            </div>
            <div className="space-y-1.5">
              <Label>People</Label>
              <PeoplePicker
                value={people}
                onChange={setPeople}
                lockedIds={[me.user.id]}
                label="People to add"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Groups</Label>
              <GroupPicker value={groupsSel} onChange={setGroupsSel} label="Groups to add" />
            </div>
            {(others.length > 0 || groupsSel.length > 0) && (
              <div className="space-y-2">
                <Label>Roles</Label>
                <ul className="divide-y rounded-xl border">
                  {others.map((p) => (
                    <li
                      key={p.id}
                      className="flex items-center justify-between gap-3 p-2.5 text-sm"
                    >
                      <PersonLabel person={p} />
                      <RoleSelect
                        value={roleOf(p.id)}
                        label={p.name ?? p.email}
                        onChange={(r) => setRoles((m) => ({ ...m, [p.id]: r }))}
                      />
                    </li>
                  ))}
                  {groupsSel.map((g) => (
                    <li
                      key={g.id}
                      className="flex items-center justify-between gap-3 p-2.5 text-sm"
                    >
                      <GroupLabel group={g} />
                      <RoleSelect
                        value={roleOf(g.id)}
                        label={g.name}
                        onChange={(r) => setRoles((m) => ({ ...m, [g.id]: r }))}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-2xl border p-4">
              <SpaceIcon icon={v.icon} spaceKey={v.key || 'X'} />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{v.name}</div>
                <div className="text-muted-foreground font-mono text-xs">{v.key.toUpperCase()}</div>
                {v.description && (
                  <p className="text-muted-foreground mt-1 text-sm">{v.description}</p>
                )}
              </div>
              <VisibilityPill visibility={v.visibility} />
            </div>
            <div className="rounded-2xl border p-4 text-sm">
              <div className="flex items-center gap-2 font-medium">
                <Kanban className="size-4" aria-hidden /> Kanban board
              </div>
              <p className="text-muted-foreground mt-1">
                Starts with To Do, In Progress, In Review and Done. You can change the columns later.
              </p>
            </div>
            <div className="rounded-2xl border p-4 text-sm">
              <div className="mb-2 flex items-center gap-2 font-medium">
                <Users className="size-4" aria-hidden /> {1 + others.length + groupsSel.length} with
                access
              </div>
              <ul className="text-muted-foreground space-y-1">
                <li>You: admin</li>
                {others.map((p) => (
                  <li key={p.id}>
                    {p.name ?? p.email}: {roleOf(p.id)}
                  </li>
                ))}
                {groupsSel.map((g) => (
                  <li key={g.id}>
                    Group {g.name}: {roleOf(g.id)}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </CardContent>

      <CardFooter className="justify-between">
        <Button
          type="button"
          variant="outline"
          disabled={step === 0 || submitting}
          onClick={() => setStep((s) => s - 1)}
        >
          Back
        </Button>
        {step < STEPS.length - 1 ? (
          <Button type="button" onClick={next}>
            Next
          </Button>
        ) : (
          <Button type="button" disabled={submitting} onClick={create}>
            {submitting ? 'Creating…' : 'Create space'}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

function RoleSelect({
  value,
  onChange,
  label,
}: {
  value: SpaceRole;
  onChange: (r: SpaceRole) => void;
  label: string;
}) {
  return (
    <Select value={value} onValueChange={(r) => onChange(r as SpaceRole)}>
      <SelectTrigger className="h-8 w-32" aria-label={`Role for ${label}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="admin">Admin</SelectItem>
        <SelectItem value="member">Member</SelectItem>
        <SelectItem value="viewer">Viewer</SelectItem>
      </SelectContent>
    </Select>
  );
}
