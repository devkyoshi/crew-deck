'use client';

import { ErrorView } from '@/components/shared/error-view';

export default function RootError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="bg-page min-h-svh">
      <ErrorView {...props} />
    </div>
  );
}
