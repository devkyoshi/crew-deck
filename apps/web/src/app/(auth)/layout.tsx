import { Layers } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-page flex min-h-svh flex-col">
      <header className="flex items-center justify-between px-5 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <span className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-md">
            <Layers className="size-3.5" aria-hidden />
          </span>
          Crew Deck
        </div>
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="animate-fade-up w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
