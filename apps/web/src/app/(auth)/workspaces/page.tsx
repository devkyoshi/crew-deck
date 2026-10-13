'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Shown on the bare domain, where no workspace can be resolved. */
export default function WorkspacesPage() {
  const [slug, setSlug] = useState('');
  const valid = /^[a-z0-9][a-z0-9-]*$/.test(slug);

  function go(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    const { protocol, host } = window.location;
    window.location.assign(`${protocol}//${slug}.${host}/sign-in`);
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">Find your workspace</CardTitle>
        <CardDescription>Enter your workspace name to continue.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={go} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="slug">Workspace</Label>
            <Input
              id="slug"
              placeholder="acme"
              autoComplete="off"
              value={slug}
              onChange={(e) => setSlug(e.target.value.trim().toLowerCase())}
            />
          </div>
          <Button type="submit" className="w-full" disabled={!valid}>
            Continue
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
