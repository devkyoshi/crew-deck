'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { api, ApiError, type CheckinLocation, type TodayState } from '@/lib/api';
import { useHydrated } from './use-hydrated';

export const TODAY_KEY = ['me-today'];

const MESSAGES: Record<string, string> = {
  already_checked_in: 'You are already checked in.',
  already_checked_out:
    'You already checked out today. Use a correction on My day to change your times.',
  not_checked_in: 'You are not checked in.',
};
export const checkinError = (e: unknown) =>
  e instanceof ApiError ? (MESSAGES[e.code] ?? e.message) : 'Something went wrong. Try again.';

/** Today's status for the signed-in person, refreshed every minute and when the tab regains focus. */
export function useToday() {
  const hydrated = useHydrated();
  const query = useQuery({
    queryKey: TODAY_KEY,
    queryFn: () => api<TodayState>('/me/today'),
    refetchInterval: 60_000,
    staleTime: 15_000,
  });
  // Several components read this (the top bar, the sidebar, the page). The top bar can finish fetching
  // before a page's code has hydrated, which would make the page's first client render differ from the
  // server HTML. Until hydration is done, everyone sees "not loaded yet".
  if (!hydrated) {
    return {
      ...query,
      data: undefined,
      isPending: true,
      isError: false,
      isSuccess: false,
      status: 'pending',
    } as typeof query;
  }
  return query;
}

export function useCheckinActions() {
  const qc = useQueryClient();
  const done = (data: TodayState) => {
    qc.setQueryData(TODAY_KEY, data);
    // Teammates' boards and my history change too.
    qc.invalidateQueries({ queryKey: ['team'] });
    qc.invalidateQueries({ queryKey: ['history'] });
    qc.invalidateQueries({ queryKey: ['me-week'] });
  };

  const checkIn = useMutation({
    mutationFn: (v: { locationType: CheckinLocation; siteId?: string; note?: string }) =>
      api<TodayState>('/checkin', { body: v }),
    onSuccess: (data) => {
      done(data);
      toast.success('Checked in');
    },
    onError: (e) => toast.error(checkinError(e)),
  });

  const checkOut = useMutation({
    mutationFn: (v: { note?: string }) => api<TodayState>('/checkout', { body: v }),
    onSuccess: (data) => {
      done(data);
      toast.success('Checked out. Have a good evening!');
    },
    onError: (e) => toast.error(checkinError(e)),
  });

  return { checkIn, checkOut };
}
