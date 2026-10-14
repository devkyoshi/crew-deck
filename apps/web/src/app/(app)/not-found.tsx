import Link from 'next/link';
import { Illustration } from '@/components/illustrations';
import { Button } from '@/components/ui/button';

export default function AppNotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <Illustration name="notfound" />
      <h1 className="text-lg font-semibold">Page not found</h1>
      <p className="text-muted-foreground text-sm">
        This page does not exist, or you do not have access to it.
      </p>
      <Button asChild>
        <Link href="/">Go home</Link>
      </Button>
    </div>
  );
}
