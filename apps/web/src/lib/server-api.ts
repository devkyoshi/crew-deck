import 'server-only';
import { cookies, headers } from 'next/headers';
import type { Me } from './api';

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

/** Server-side call to the API on behalf of the current request (forwards cookie and tenant host). */
export async function serverFetch(path: string) {
  const h = await headers();
  const c = await cookies();
  return fetch(`${API_INTERNAL_URL}/api/v1${path}`, {
    cache: 'no-store',
    headers: {
      cookie: c.toString(),
      'x-forwarded-host': h.get('host') ?? '',
    },
  });
}

/** The signed-in user for this request, or null. */
export async function getMe(): Promise<Me | null> {
  const res = await serverFetch('/me');
  if (!res.ok) return null;
  return (await res.json()) as Me;
}
