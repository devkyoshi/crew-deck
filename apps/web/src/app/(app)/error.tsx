'use client';

import { ErrorView } from '@/components/shared/error-view';

/** Errors inside the signed-in app keep the sidebar and top bar, so people can navigate away. */
export default function AppError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorView {...props} />;
}
