import Link from 'next/link';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Stands in for a button whose feature is not in the plan: explains why and links to the plans. */
export function LockedButton({
  children,
  plan = 'Team',
}: {
  children: React.ReactNode;
  plan?: string;
}) {
  return (
    <Button variant="outline" asChild title={`Included from the ${plan} plan`}>
      <Link href="/admin/billing">
        <Lock className="size-4" aria-hidden /> {children}
        <span className="sr-only"> (included from the {plan} plan)</span>
      </Link>
    </Button>
  );
}
