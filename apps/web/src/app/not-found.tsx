import Link from 'next/link';
import { SearchX } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="bg-page flex min-h-svh items-center justify-center px-4">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <span className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-full">
          <SearchX className="size-6" aria-hidden />
        </span>
        <h1 className="text-lg font-semibold">Page not found</h1>
        <p className="text-muted-foreground text-sm">
          The page you are looking for does not exist, or you do not have access to it.
        </p>
        <Button asChild>
          <Link href="/">Go home</Link>
        </Button>
      </div>
    </div>
  );
}
