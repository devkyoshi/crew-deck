'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Celebrate } from '@/components/shared/celebrate';
import { Notice } from '@/components/shared/notice';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { FormActions, FormSection } from '@/components/ui/form-layout';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useFormFeedback } from '@/hooks/use-form-feedback';
import { api, ApiError } from '@/lib/api';

function Form() {
  const params = useSearchParams();
  const [key, setKey] = useState((params.get('key') ?? '').toUpperCase());
  const [message, setMessage] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  const { shakeKey, fail } = useFormFeedback();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[A-Z][A-Z0-9]{1,9}$/.test(key)) {
      setKeyError(
        key ? 'Use 2 to 10 letters or digits, starting with a letter' : 'Enter the space key',
      );
      fail();
      return;
    }
    setState('sending');
    setError(null);
    try {
      // The answer is the same whether or not the space exists, by design.
      await api(`/spaces/${key}/access-requests`, { body: message ? { message } : {} });
      setState('sent');
    } catch (err) {
      setState('idle');
      setError(err instanceof ApiError ? err.message : 'Could not send the request. Try again.');
    }
  }

  if (state === 'sent') {
    return (
      <Card className="max-w-xl">
        <CardContent className="flex flex-col items-center gap-3 py-6 text-center">
          <Celebrate />
          <div className="font-medium">Request sent</div>
          <p className="text-muted-foreground max-w-sm text-sm">
            If that space exists and is private, its admins have been asked to review your request.
            You will get access as soon as one approves it.
          </p>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" asChild>
              <Link href="/access-requests">View my requests</Link>
            </Button>
            <Button asChild>
              <Link href="/spaces">Back to spaces</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>Ask for access</CardTitle>
        <CardDescription>
          Private spaces are hidden from people who are not in them. Enter the space key an admin
          gave you and they will be asked to let you in.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-5" noValidate>
          {error && <Notice variant="error">{error}</Notice>}
          <FormSection title="Which space?">
            <Field label="Space key" htmlFor="ra-key" error={keyError} shakeKey={shakeKey}>
              <Input
                className="max-w-40 font-mono uppercase"
                placeholder="ENG"
                maxLength={10}
                autoComplete="off"
                value={key}
                onChange={(e) => {
                  setKey(e.target.value.toUpperCase());
                  setKeyError(null);
                }}
              />
            </Field>
          </FormSection>
          <FormSection title="Why do you need it?">
            <Field label="Message (optional)" htmlFor="ra-msg">
              <Textarea
                rows={3}
                maxLength={500}
                placeholder="Why do you need access?"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </Field>
          </FormSection>
          <FormActions className="justify-start">
            <Button type="submit" loading={state === 'sending'}>
              {state === 'sending' ? 'Sending…' : 'Request access'}
            </Button>
          </FormActions>
        </form>
      </CardContent>
    </Card>
  );
}

export default function RequestAccessPage() {
  return (
    <>
      <PageHeader
        title="Request access"
        description="Ask the admins of a private space to let you in."
      />
      <Suspense fallback={null}>
        <Form />
      </Suspense>
    </>
  );
}
