'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api, ApiError } from '@/lib/api';
import { CURRENCIES, recordHref, type Lead } from '@/lib/crm';
import { cn } from '@/lib/utils';
import { CompanyPicker } from './crm-bits';

type Mode = 'new' | 'existing' | 'none';

function Choice<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-full border px-3 py-1 text-sm',
            value === o.value
              ? 'bg-accent text-accent-foreground border-primary'
              : 'hover:bg-muted',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Turn a lead into a company, a contact and a deal in one step. */
export function ConvertDialog({ lead }: { lead: Lead }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [companyMode, setCompanyMode] = useState<Mode>(lead.companyName ? 'new' : 'none');
  const [companyName, setCompanyName] = useState(lead.companyName ?? '');
  const [existing, setExisting] = useState<{ id: string; name: string } | null>(null);
  const [contactMode, setContactMode] = useState<'new' | 'none'>('new');
  const [makeDeal, setMakeDeal] = useState(true);
  const [dealTitle, setDealTitle] = useState(
    lead.companyName ? `${lead.companyName} deal` : `${lead.name} deal`,
  );
  const [value, setValue] = useState('0');
  const [currency, setCurrency] = useState('USD');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (companyMode === 'new' && !companyName.trim()) return setError('Enter a company name');
    if (companyMode === 'existing' && !existing) return setError('Choose a company');
    if (makeDeal && !dealTitle.trim()) return setError('Enter a deal title');
    setBusy(true);
    try {
      const out = await api<{
        companyId: string | null;
        contactId: string | null;
        dealId: string | null;
      }>(`/crm/leads/${lead.id}/convert`, {
        method: 'POST',
        body: {
          company:
            companyMode === 'new'
              ? { mode: 'new', name: companyName.trim() }
              : companyMode === 'existing'
                ? { mode: 'existing', id: existing!.id }
                : { mode: 'none' },
          contact:
            contactMode === 'new'
              ? { mode: 'new', name: lead.name, email: lead.email ?? '' }
              : { mode: 'none' },
          deal: makeDeal ? { title: dealTitle.trim(), value: Number(value) || 0, currency } : null,
        },
      });
      toast.success('Lead converted');
      await qc.invalidateQueries({ queryKey: ['crm'] });
      setOpen(false);
      router.push(
        out.dealId
          ? recordHref('deal', out.dealId)
          : out.contactId
            ? recordHref('contact', out.contactId)
            : recordHref('lead', lead.id),
      );
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.fields
            ? Object.values(err.fields)[0]!
            : err.message
          : 'Could not convert the lead',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <ArrowRightLeft className="size-4" aria-hidden /> Convert lead
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Convert {lead.name}</DialogTitle>
          <DialogDescription>
            Create the records you need in one step. If anything fails, nothing is created.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-5" noValidate>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Company</legend>
            <Choice<Mode>
              label="Company"
              value={companyMode}
              onChange={setCompanyMode}
              options={[
                { value: 'new', label: 'Create new' },
                { value: 'existing', label: 'Use existing' },
                { value: 'none', label: 'Skip' },
              ]}
            />
            {companyMode === 'new' && (
              <>
                <Label htmlFor="cv-company" className="sr-only">
                  Company name
                </Label>
                <Input
                  id="cv-company"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Company name"
                  maxLength={120}
                />
              </>
            )}
            {companyMode === 'existing' && (
              <CompanyPicker value={existing?.id} label={existing?.name} onChange={setExisting} />
            )}
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Contact</legend>
            <Choice<'new' | 'none'>
              label="Contact"
              value={contactMode}
              onChange={setContactMode}
              options={[
                { value: 'new', label: `Create ${lead.name}` },
                { value: 'none', label: 'Skip' },
              ]}
            />
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Deal</legend>
            <div className="flex items-center gap-2">
              <Checkbox id="cv-deal" checked={makeDeal} onCheckedChange={(v) => setMakeDeal(!!v)} />
              <Label htmlFor="cv-deal" className="font-normal">
                Create a deal in the first pipeline stage
              </Label>
            </div>
            {makeDeal && (
              <div className="grid gap-2 sm:grid-cols-[1fr_7rem_6rem]">
                <div className="space-y-1">
                  <Label htmlFor="cv-title">Title</Label>
                  <Input
                    id="cv-title"
                    value={dealTitle}
                    onChange={(e) => setDealTitle(e.target.value)}
                    maxLength={160}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="cv-value">Value</Label>
                  <Input
                    id="cv-value"
                    type="number"
                    min={0}
                    step="any"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="cv-cur">Currency</Label>
                  <Select value={currency} onValueChange={setCurrency}>
                    <SelectTrigger id="cv-cur" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </fieldset>

          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Converting…' : 'Convert'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
