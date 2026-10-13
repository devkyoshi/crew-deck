import { ThemeToggle } from '@/components/theme-toggle';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Crew Deck</h1>
      <p className="text-muted-foreground">
        Foundation is running. The app shell arrives in Phase 1.
      </p>
      <ThemeToggle />
    </main>
  );
}
