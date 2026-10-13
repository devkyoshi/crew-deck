import { notFound } from 'next/navigation';
import { ThemeToggle } from '@/components/theme-toggle';
import { Showcase } from './showcase';

export const metadata = { title: 'Design system · Crew Deck' };

export default function DesignPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-muted-foreground text-xs">
          Left: light tokens. Right: dark tokens. The toggle switches the page theme.
        </p>
        <ThemeToggle />
      </div>
      <div className="grid gap-8 xl:grid-cols-2">
        <div className="light bg-background text-foreground rounded-xl border p-5">
          <Showcase />
        </div>
        <div className="dark bg-background text-foreground rounded-xl border p-5">
          <Showcase />
        </div>
      </div>
    </div>
  );
}
