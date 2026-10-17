'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { SplitHeading } from '@/components/auth/auth-split-layout';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useFormFeedback } from '@/hooks/use-form-feedback';
import { readRecentWorkspaces, type RecentWorkspace } from '@/lib/recent-workspaces';

/** Shown on the bare domain, where no workspace can be resolved. */
export default function WorkspacesPage() {
  const [slug, setSlug] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { shakeKey, fail } = useFormFeedback();
  const [recent, setRecent] = useState<RecentWorkspace[]>([]);
  useEffect(() => setRecent(readRecentWorkspaces()), []);

  function open(slug: string) {
    const { protocol, host } = window.location;
    window.location.assign(`${protocol}//${slug}.${host}/sign-in`);
  }

  function go(e: React.FormEvent) {
    e.preventDefault();
    if (!slug) {
      setError('Enter your workspace name');
      fail();
      return;
    }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
      setError('Use lowercase letters, digits and hyphens');
      fail();
      return;
    }
    const { protocol, host } = window.location;
    window.location.assign(`${protocol}//${slug}.${host}/sign-in`);
  }

  return (
    <>
      <SplitHeading
        title="Find your workspace"
        lead="Enter your team or company name to continue"
      />
      <div className="space-y-5">
        {recent.length > 0 && (
          <section aria-labelledby="recent" className="space-y-2.5">
            <h2
              id="recent"
              className="text-muted-foreground text-xs font-semibold tracking-wider uppercase"
            >
              Recent workspaces
            </h2>
            <ul className="space-y-2">
              {recent.map((w, i) => (
                <motion.li
                  key={w.slug}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.05 * i, duration: 0.25 }}
                >
                  <button
                    type="button"
                    className="group border-border hover:border-primary/50 hover:bg-muted/40 focus-visible:ring-primary/40 flex w-full items-center justify-between rounded-lg border p-3 text-left transition-colors focus-visible:ring-2 focus-visible:outline-hidden"
                    onClick={() => open(w.slug)}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold">
                        {w.name.slice(0, 2).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{w.name}</p>
                        <p className="text-muted-foreground truncate font-mono text-xs">{w.slug}</p>
                      </div>
                    </div>
                    <ArrowRight className="text-muted-foreground size-4 transition-transform group-hover:translate-x-0.5" />
                  </button>
                </motion.li>
              ))}
            </ul>
            <div className="text-muted-foreground flex items-center gap-3 pt-1 text-xs">
              <Separator className="flex-1" />
              Or enter another
              <Separator className="flex-1" />
            </div>
          </section>
        )}
        <form onSubmit={go} className="space-y-4" noValidate>
          <Field label="Workspace" htmlFor="slug" error={error} shakeKey={shakeKey}>
            <Input
              placeholder="acme"
              autoComplete="off"
              className="h-11 rounded-lg"
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value.trim().toLowerCase());
                setError(null);
              }}
            />
          </Field>
          <Button type="submit" className="h-11 w-full rounded-lg font-medium">
            Continue <ArrowRight />
          </Button>
        </form>
        <p className="text-muted-foreground text-center text-xs">
          New here?{' '}
          <Link href="/signup" className="text-foreground font-medium underline underline-offset-4">
            Create a workspace
          </Link>{' '}
          or{' '}
          <Link href="/pricing" className="text-foreground font-medium underline underline-offset-4">
            see pricing
          </Link>
        </p>
      </div>
    </>
  );
}
