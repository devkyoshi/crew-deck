import Link from 'next/link';
import { SearchX } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function AppNotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <span className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-full">
        <SearchX className="size-6" aria-hidden />
      </span>
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
