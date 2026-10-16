'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

interface LiveMessage {
  spaceId: string;
  kinds: string[];
  itemIds: string[];
  actorId: string | null;
}

/**
 * Keeps a space's screens current: listens to the space's event stream and refreshes the board, list,
 * backlog and any open item when someone changes them. The browser reconnects by itself; refetching on
 * focus stays as the fallback. Returns the connection state for a quiet "reconnecting" hint.
 */
export function useLiveSpace(spaceKey: string | null | undefined) {
  const qc = useQueryClient();
  const [state, setState] = useState<'connecting' | 'live' | 'reconnecting'>('connecting');

  useEffect(() => {
    if (!spaceKey || typeof EventSource === 'undefined') return;
    const es = new EventSource(`/api/v1/spaces/${encodeURIComponent(spaceKey)}/events`);
    let pending: ReturnType<typeof setTimeout> | null = null;
    const changedItems = new Set<string>();
    const kinds = new Set<string>();

    // Several changes in quick succession (a bulk move) become one refresh.
    const flush = () => {
      pending = null;
      const key = spaceKey.toUpperCase();
      for (const k of ['board', 'list', 'backlog', 'epics', 'statuses', 'labels']) {
        void qc.invalidateQueries({ queryKey: [k, key] });
      }
      void qc.invalidateQueries({ queryKey: ['subtasks'] });
      void qc.invalidateQueries({ queryKey: ['my-items'] });
      if (kinds.has('sprint')) void qc.invalidateQueries({ queryKey: ['sprints'] });
      if (kinds.has('version')) {
        for (const k of ['versions', 'components', 'release-notes', 'roadmap', 'calendar']) void qc.invalidateQueries({ queryKey: [k] });
      }
      if (kinds.has('document')) void qc.invalidateQueries({ queryKey: ['space-docs', key] });
      // Dates, time and work on items move the roadmap, calendar and reports.
      for (const k of ['roadmap', 'calendar', 'flow-reports']) void qc.invalidateQueries({ queryKey: [k] });
      void qc.invalidateQueries({ queryKey: ['worklogs'] });
      if (changedItems.size) {
        void qc.invalidateQueries({ queryKey: ['item'] });
        for (const id of changedItems) {
          for (const k of ['activity', 'comments', 'links', 'attachments', 'watchers']) {
            void qc.invalidateQueries({ queryKey: [k, id] });
          }
        }
      }
      changedItems.clear();
      kinds.clear();
    };

    es.addEventListener('ready', () => setState('live'));
    es.addEventListener('change', (e) => {
      try {
        const msg = JSON.parse((e as MessageEvent<string>).data) as LiveMessage;
        msg.itemIds.forEach((id) => changedItems.add(id));
        msg.kinds.forEach((k) => kinds.add(k));
      } catch {
        return;
      }
      if (!pending) pending = setTimeout(flush, 150);
    });
    es.addEventListener('revoked', () => {
      es.close();
      setState('reconnecting');
    });
    es.onerror = () => setState('reconnecting');
    es.onopen = () => setState('live');

    return () => {
      if (pending) clearTimeout(pending);
      es.close();
    };
  }, [spaceKey, qc]);

  return state;
}
