import { PageSkeleton } from '@/components/shared/skeletons';

/** Shown while a page's server part loads. Sized like a typical page so nothing jumps. */
export default function Loading() {
  return <PageSkeleton />;
}
