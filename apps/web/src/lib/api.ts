import type { ErrorResponse } from '@crew-deck/shared';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export interface Me {
  user: {
    id: string;
    email: string;
    name: string | null;
    avatarUrl: string | null;
    jobTitle: string | null;
    timezone: string;
  };
  org: { id: string; name: string; slug: string; domain: string };
  orgRole: 'owner' | 'admin' | 'member';
  permissions: string[];
  orgs: { id: string; name: string; slug: string; orgRole: string }[];
}

export interface Providers {
  tenant: { name: string; slug: string } | null;
  password: boolean;
  google: boolean;
  devLogin: boolean;
}

/** Browser-side JSON call to the same-origin API proxy. */
export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method: init?.method ?? (init?.body ? 'POST' : 'GET'),
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data ?? {}) as Partial<ErrorResponse>;
    throw new ApiError(
      res.status,
      err.code ?? 'error',
      err.message ?? 'Something went wrong',
      err.fields,
    );
  }
  return data as T;
}

export type OrgRole = 'owner' | 'admin' | 'member';
export type MemberStatus = 'active' | 'invited' | 'deactivated';

export interface Member {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  jobTitle: string | null;
  timezone: string;
  orgRole: OrgRole;
  status: MemberStatus;
  lastLoginAt: string | null;
  joinedAt: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Invitation {
  id: string;
  email: string;
  orgRole: OrgRole;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expiresAt: string;
  createdAt: string;
  invitedByName: string | null;
}

export type InviteResultStatus =
  'invited' | 'already_member' | 'deactivated_member' | 'already_invited' | 'invalid_domain';

export interface InviteResponse {
  results: { email: string; status: InviteResultStatus; invitationId?: string; link?: string }[];
  emailDelivery: boolean;
}

export const qs = (params: Record<string, string | number | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
