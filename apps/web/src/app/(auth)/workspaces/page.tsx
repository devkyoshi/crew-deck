'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Illustration } from '@/components/illustrations';
import { useFormFeedback } from '@/hooks/use-form-feedback';

/** Shown on the bare domain, where no workspace can be resolved. */
export default function WorkspacesPage() {
  const [slug, setSlug] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { shakeKey, fail } = useFormFeedback();

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
    <Card>
      <CardHeader className="items-center text-center">
        <Illustration name="spaces" className="mb-1 h-20" />
        <CardTitle className="text-xl">Find your workspace</CardTitle>
        <CardDescription>Enter your workspace name to continue.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={go} className="space-y-3" noValidate>
          <Field label="Workspace" htmlFor="slug" error={error} shakeKey={shakeKey}>
            <Input
              placeholder="acme"
              autoComplete="off"
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value.trim().toLowerCase());
                setError(null);
              }}
            />
          </Field>
          <Button type="submit" className="w-full">
            Continue <ArrowRight />
          </Button>
        </form>
        <p className="text-muted-foreground mt-4 text-center text-sm">
          New here?{' '}
          <Link href="/signup" className="text-primary underline underline-offset-4">
            Create a workspace
          </Link>{' '}
          or{' '}
          <Link href="/pricing" className="text-primary underline underline-offset-4">
            see pricing
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
