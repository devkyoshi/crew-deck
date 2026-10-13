'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Check, Copy, Info, Plus, UserPlus, Users, FolderKanban } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Chip } from '@/components/shared/pastel';
import { RoleBadge } from '@/components/shared/badges';
import { Stepper } from '@/components/shared/stepper';
import { useMe } from '@/components/shell/me-context';
import { api, type InviteResponse, type InviteResultStatus, type OrgRole } from '@/lib/api';
import { errorText } from './use-member-actions';

const STEPS = ['People', 'Access', 'Review'];
const emailSchema = z.string().email();

const RESULT_TEXT: Record<InviteResultStatus, { label: string; ok: boolean }> = {
  invited: { label: 'Invited', ok: true },
  already_member: { label: 'Already a member', ok: false },
  deactivated_member: { label: 'Deactivated member: reactivate them instead', ok: false },
  already_invited: { label: 'Already has a pending invite', ok: false },
  invalid_domain: { label: 'Not on the workspace email domain', ok: false },
};

/** Splits pasted text on commas, semicolons, spaces and newlines; lowercases and de-duplicates. */
export function parseEmails(text: string) {
  const parts = text
    .split(/[\s,;]+/)
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(parts)];
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          toast.error('Could not copy. Select the link and copy it manually.');
        }
      }}
    >
      {done ? <Check /> : <Copy />} {done ? 'Copied' : 'Copy link'}
    </Button>
  );
}

export function InviteDialog() {
  const me = useMe();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [text, setText] = useState('');
  const [role, setRole] = useState<OrgRole>('member');
  const [touched, setTouched] = useState(false);
  const [response, setResponse] = useState<InviteResponse | null>(null);

  const emails = useMemo(() => parseEmails(text), [text]);
  const domain = me.org.domain.toLowerCase();
  const problems = useMemo(() => {
    const out: string[] = [];
    if (emails.length === 0) out.push('Enter at least one email address.');
    if (emails.length > 50) out.push('You can invite up to 50 people at a time.');
    const bad = emails.filter((e) => !emailSchema.safeParse(e).success);
    if (bad.length) out.push(`Not a valid email: ${bad.join(', ')}`);
    const wrong = emails.filter(
      (e) => emailSchema.safeParse(e).success && e.split('@')[1] !== domain,
    );
    if (wrong.length) out.push(`Must end in @${domain}: ${wrong.join(', ')}`);
    return out;
  }, [emails, domain]);

  const send = useMutation({
    mutationFn: () => api<InviteResponse>('/invitations', { body: { emails, orgRole: role } }),
    onSuccess: (r) => {
      setResponse(r);
      qc.invalidateQueries({ queryKey: ['invitations'] });
      const n = r.results.filter((x) => x.status === 'invited').length;
      if (n > 0 && r.emailDelivery) toast.success(`${n} invitation${n === 1 ? '' : 's'} sent`);
    },
    onError: (e) => toast.error(errorText(e)),
  });

  function reset() {
    setStep(0);
    setText('');
    setRole('member');
    setTouched(false);
    setResponse(null);
    send.reset();
  }

  function next() {
    if (step === 0) {
      setTouched(true);
      if (problems.length) return;
    }
    setStep((s) => s + 1);
  }

  const canOwn = me.orgRole === 'owner';

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus /> Invite people
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Invite people to {me.org.name}</DialogTitle>
          <DialogDescription>
            {response
              ? 'Here is how each invitation went.'
              : 'They will get an email with a link to join.'}
          </DialogDescription>
        </DialogHeader>

        {response ? (
          <div className="space-y-3">
            {!response.emailDelivery && (
              <div className="bg-accent text-accent-foreground flex gap-2 rounded-xl p-3 text-sm">
                <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
                Email delivery is not set up, so nothing was emailed. Share each link yourself.
              </div>
            )}
            <ul className="divide-y rounded-xl border">
              {response.results.map((r) => {
                const t = RESULT_TEXT[r.status];
                return (
                  <li key={r.email} className="space-y-2 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{r.email}</div>
                        <div
                          className={
                            t.ok
                              ? 'text-xs text-emerald-600 dark:text-emerald-400'
                              : 'text-muted-foreground text-xs'
                          }
                        >
                          {t.label}
                        </div>
                      </div>
                      {r.link && <CopyButton text={r.link} />}
                    </div>
                    {r.link && (
                      <input
                        readOnly
                        value={r.link}
                        aria-label={`Invite link for ${r.email}`}
                        onFocus={(e) => e.currentTarget.select()}
                        className="bg-muted text-muted-foreground w-full rounded-lg px-2.5 py-1.5 font-mono text-xs"
                      />
                    )}
                  </li>
                );
              })}
            </ul>
            <DialogFooter>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <Stepper steps={STEPS} current={step} />

            {step === 0 && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="invite-emails">Email addresses</Label>
                  <Textarea
                    id="invite-emails"
                    rows={4}
                    placeholder={`ada@${domain}, grace@${domain}`}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    aria-invalid={touched && problems.length > 0}
                    aria-describedby="invite-emails-help"
                  />
                  <p id="invite-emails-help" className="text-muted-foreground text-xs">
                    Separate with commas, spaces or new lines. Addresses must end in @{domain}.
                  </p>
                  {touched && problems.length > 0 && (
                    <div role="alert" className="text-destructive flex gap-1.5 text-xs">
                      <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                      <div>
                        {problems.map((p) => (
                          <div key={p}>{p}</div>
                        ))}
                      </div>
                    </div>
                  )}
                  {emails.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {emails.slice(0, 12).map((e) => (
                        <Chip key={e}>{e}</Chip>
                      ))}
                      {emails.length > 12 && <Chip>+{emails.length - 12} more</Chip>}
                    </div>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>Role</Label>
                  <Select value={role} onValueChange={(v) => setRole(v as OrgRole)}>
                    <SelectTrigger className="w-full" aria-label="Role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="member">Member: everyday access</SelectItem>
                      <SelectItem value="admin">Admin: manages people and spaces</SelectItem>
                      {canOwn && <SelectItem value="owner">Owner: full control</SelectItem>}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-3">
                {[
                  { icon: Users, title: 'Groups', phase: 3 },
                  { icon: FolderKanban, title: 'Spaces', phase: 4 },
                ].map((s) => (
                  <div
                    key={s.title}
                    className="flex items-center gap-3 rounded-xl border border-dashed p-4"
                  >
                    <span className="bg-muted text-muted-foreground flex size-9 items-center justify-center rounded-lg">
                      <s.icon className="size-4" aria-hidden />
                    </span>
                    <div>
                      <div className="font-medium">{s.title}</div>
                      <div className="text-muted-foreground text-xs">
                        Choosing {s.title.toLowerCase()} to join arrives in Phase {s.phase}. For
                        now, add people to them after they join.
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {step === 2 && (
              <div className="space-y-3">
                <div className="rounded-xl border p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-medium">
                      {emails.length} {emails.length === 1 ? 'person' : 'people'}
                    </span>
                    <RoleBadge role={role} />
                  </div>
                  <ul className="text-muted-foreground max-h-40 space-y-1 overflow-y-auto text-sm">
                    {emails.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                </div>
                <p className="text-muted-foreground text-xs">
                  Invitations expire after 7 days. You can resend or revoke them from the Pending
                  invites tab.
                </p>
              </div>
            )}

            <DialogFooter className="gap-2 sm:justify-between">
              <Button
                type="button"
                variant="outline"
                disabled={step === 0 || send.isPending}
                onClick={() => setStep((s) => s - 1)}
              >
                Back
              </Button>
              {step < STEPS.length - 1 ? (
                <Button type="button" onClick={next}>
                  Next
                </Button>
              ) : (
                <Button type="button" disabled={send.isPending} onClick={() => send.mutate()}>
                  <UserPlus />
                  {send.isPending
                    ? 'Sending…'
                    : `Send ${emails.length} invitation${emails.length === 1 ? '' : 's'}`}
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
