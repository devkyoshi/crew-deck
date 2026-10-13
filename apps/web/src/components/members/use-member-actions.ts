'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError, type Member, type OrgRole } from '@/lib/api';

const ERROR_TEXT: Record<string, string> = {
  last_owner: 'A workspace needs at least one owner.',
  cannot_deactivate_self: 'You cannot deactivate yourself.',
  forbidden: 'You do not have permission to do that.',
};

export const errorText = (e: unknown) =>
  e instanceof ApiError ? (ERROR_TEXT[e.code] ?? e.message) : 'Something went wrong. Try again.';

/** Role / status mutations shared by the members table and the profile page. */
export function useMemberActions() {
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['members'] });
    qc.invalidateQueries({ queryKey: ['member'] });
  };

  const setRole = useMutation({
    mutationFn: ({ id, orgRole }: { id: string; orgRole: OrgRole }) =>
      api<Member>(`/members/${id}`, { method: 'PATCH', body: { orgRole } }),
    onSuccess: (m) => {
      toast.success(`${m.name ?? m.email} is now ${m.orgRole}`);
      refresh();
    },
    onError: (e) => toast.error(errorText(e)),
  });

  const setActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api<Member>(`/members/${id}/${active ? 'reactivate' : 'deactivate'}`, {
        method: 'POST',
        body: {},
      }),
    onSuccess: (m, v) => {
      toast.success(`${m.name ?? m.email} ${v.active ? 'reactivated' : 'deactivated'}`);
      refresh();
    },
    onError: (e) => toast.error(errorText(e)),
  });

  return { setRole, setActive, refresh };
}

/** What the signed-in person may do to a target. Mirrors the server's can(); the API still enforces it. */
export function actionsFor(me: { id: string; role: OrgRole }, target: Member) {
  const admin = me.role === 'owner' || me.role === 'admin';
  const touchesOwner = target.orgRole === 'owner' && me.role !== 'owner';
  return {
    canChangeRole: admin && !touchesOwner,
    canOwn: me.role === 'owner',
    canToggleActive: admin && !touchesOwner && target.id !== me.id,
  };
}
