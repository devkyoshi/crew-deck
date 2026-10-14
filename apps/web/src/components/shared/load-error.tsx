import { RotateCw, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/empty-state';

/** Standard "could not load" block with a retry. */
export function LoadError({ what, onRetry }: { what: string; onRetry?: () => void }) {
  return (
    <EmptyState
      icon={TriangleAlert}
      title={`Could not load ${what}`}
      description="Something went wrong. Check your connection and try again."
      action={
        onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RotateCw /> Try again
          </Button>
        )
      }
    />
  );
}
