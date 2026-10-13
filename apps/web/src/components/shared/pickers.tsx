'use client';

import { Users } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { MultiPicker } from '@/components/shared/multi-picker';
import { initials } from '@/components/shell/me-context';
import { api, qs, type GroupSummary, type Member, type Page } from '@/lib/api';

export type PickedPerson = Pick<Member, 'id' | 'name' | 'email' | 'avatarUrl'>;
export type PickedGroup = Pick<GroupSummary, 'id' | 'name'>;

export function PersonLabel({ person }: { person: PickedPerson }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Avatar className="size-5">
        {person.avatarUrl && <AvatarImage src={person.avatarUrl} alt="" />}
        <AvatarFallback className="text-[9px]">
          {initials(person.name, person.email)}
        </AvatarFallback>
      </Avatar>
      <span className="truncate">{person.name ?? person.email}</span>
    </span>
  );
}

export function GroupLabel({ group }: { group: PickedGroup }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300 flex size-5 items-center justify-center rounded-full">
        <Users className="size-3" aria-hidden />
      </span>
      <span className="truncate">{group.name}</span>
    </span>
  );
}

/** Searchable multi-select of active workspace members, with avatars. */
export function PeoplePicker({
  value,
  onChange,
  lockedIds,
  label = 'People',
}: {
  value: PickedPerson[];
  onChange: (v: PickedPerson[]) => void;
  lockedIds?: string[];
  label?: string;
}) {
  return (
    <MultiPicker<PickedPerson>
      label={label}
      queryKey="people"
      value={value}
      onChange={onChange}
      lockedIds={lockedIds}
      placeholder="Add people"
      searchPlaceholder="Search by name or email"
      emptyText="No one found."
      search={async (q) =>
        (await api<Page<Member>>(`/members${qs({ q, status: 'active', pageSize: 20 })}`)).items
      }
      renderItem={(p) => <PersonLabel person={p} />}
    />
  );
}

/** Searchable multi-select of groups. Reused by the invite form and the space creator. */
export function GroupPicker({
  value,
  onChange,
  label = 'Groups',
}: {
  value: PickedGroup[];
  onChange: (v: PickedGroup[]) => void;
  label?: string;
}) {
  return (
    <MultiPicker<PickedGroup>
      label={label}
      queryKey="groups"
      value={value}
      onChange={onChange}
      placeholder="Add groups"
      searchPlaceholder="Search groups"
      emptyText="No groups found."
      search={async (q) =>
        (await api<Page<GroupSummary>>(`/groups${qs({ q, pageSize: 20 })}`)).items
      }
      renderItem={(g) => <GroupLabel group={g} />}
    />
  );
}
