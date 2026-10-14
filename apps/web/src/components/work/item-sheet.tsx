'use client';

import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { ItemDetail } from './item-detail';

/** Reads and writes the page's query string, keeping everything else in place. */
export function useUrlState() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const push = useCallback(
    (mutate: (p: URLSearchParams) => void, replace = false) => {
      const next = new URLSearchParams(params.toString());
      mutate(next);
      const q = next.toString();
      const url = q ? `${pathname}?${q}` : pathname;
      if (replace) router.replace(url, { scroll: false });
      else router.push(url, { scroll: false });
    },
    [params, pathname, router],
  );
  return { params, push };
}

/** The open item (`?item=KEY`) as a side panel, so the list or page stays visible behind it. */
export function ItemSheet() {
  const { params, push } = useUrlState();
  const openRef = params.get('item');
  const setOpen = (key: string | null) => push((p) => (key ? p.set('item', key) : p.delete('item')));
  return (
    <Sheet open={!!openRef} onOpenChange={(o) => !o && setOpen(null)}>
      <SheetContent side="right" showCloseButton={false} className="w-full gap-0 overflow-y-auto p-0 sm:max-w-3xl">
        <SheetTitle className="sr-only">Work item {openRef}</SheetTitle>
        <SheetDescription className="sr-only">Details and fields for the selected work item</SheetDescription>
        {openRef && (
          <ItemDetail itemRef={openRef} variant="panel" onClose={() => setOpen(null)} onOpenItem={(key) => setOpen(key)} />
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Opens an item in the page's side panel. */
export function useOpenItem() {
  const { push } = useUrlState();
  return (key: string) => push((p) => p.set('item', key));
}
