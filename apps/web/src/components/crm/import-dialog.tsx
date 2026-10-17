'use client';

import { Notice } from '@/components/shared/notice';
import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, TriangleAlert, Upload } from 'lucide-react';
import { toast } from 'sonner';
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
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Stepper } from '@/components/shared/stepper';
import { api, ApiError } from '@/lib/api';
import type { ImportResult } from '@/lib/crm';

type ImportType = 'companies' | 'contacts' | 'leads';
interface FieldInfo {
  key: string;
  label: string;
  required?: boolean;
}

const NONE = '__none';
const STEPS = ['Upload', 'Map columns', 'Check', 'Done'];

/** Minimal header-row reader; the server does the real parsing and validation. */
function headerOf(text: string) {
  const first = text.replace(String.fromCharCode(0xfeff), '').split(/\r?\n/)[0] ?? '';
  const cols: string[] = [];
  let cell = '';
  let quoted = false;
  for (const ch of first) {
    if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) {
      cols.push(cell.trim());
      cell = '';
    } else cell += ch;
  }
  cols.push(cell.trim());
  return cols.filter(Boolean);
}

const guess = (field: FieldInfo, header: string[]) =>
  header.find((h) => h.toLowerCase().replace(/[^a-z]/g, '') === field.key.toLowerCase()) ??
  header.find(
    (h) =>
      h.toLowerCase().replace(/[^a-z]/g, '') ===
      field.label
        .toLowerCase()
        .replace(/[^a-z]/g, '')
        .split('(')[0],
  ) ??
  '';

export function ImportDialog({ type }: { type: ImportType }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [header, setHeader] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const info = useQuery({
    queryKey: ['crm-import-fields', type],
    queryFn: () => api<{ fields: FieldInfo[]; maxRows: number }>(`/crm/import/${type}/fields`),
    enabled: open,
  });

  function reset() {
    setStep(0);
    setCsv('');
    setFileName('');
    setHeader([]);
    setMapping({});
    setResult(null);
    setError(null);
  }

  async function onFile(file: File | undefined) {
    setError(null);
    if (!file) return;
    if (file.size > 3_000_000) {
      setError('That file is larger than 3 MB. Split it into smaller files.');
      return;
    }
    const text = await file.text();
    const cols = headerOf(text);
    if (cols.length === 0) {
      setError('The first row must be a header with column names.');
      return;
    }
    setCsv(text);
    setFileName(file.name);
    setHeader(cols);
    const next: Record<string, string> = {};
    for (const f of info.data?.fields ?? []) next[f.key] = guess(f, cols);
    setMapping(next);
    setStep(1);
  }

  async function run(dryRun: boolean) {
    setBusy(true);
    setError(null);
    try {
      const body = { csv, mapping, dryRun };
      const res = await fetch(`/api/v1/crm/import/${type}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok && res.status !== 422)
        throw new ApiError(
          res.status,
          data.code ?? 'error',
          data.message ?? 'Import failed',
          data.fields,
        );
      setResult(data as ImportResult);
      if (dryRun) setStep(2);
      else if (res.ok) {
        setStep(3);
        toast.success(`Imported ${(data as ImportResult).created} ${type}`);
        await qc.invalidateQueries({ queryKey: ['crm'] });
      } else setStep(2);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  }

  const missingRequired = (info.data?.fields ?? []).some((f) => f.required && !mapping[f.key]);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <Upload className="size-4" aria-hidden /> Import
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import {type}</DialogTitle>
          <DialogDescription>
            Upload a CSV file. Nothing is saved until you confirm, and a file with any invalid row
            is rejected as a whole.
          </DialogDescription>
        </DialogHeader>
        <Stepper steps={STEPS} current={step} />

        {error && <Notice variant="error">{error}</Notice>}

        {step === 0 && (
          <div className="space-y-3">
            <Label htmlFor="csv-file">CSV file</Label>
            <input
              id="csv-file"
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              disabled={info.isPending}
              onChange={(e) => void onFile(e.target.files?.[0])}
              className="file:bg-primary file:text-primary-foreground block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:px-3 file:py-1.5"
            />
            <p className="text-muted-foreground text-xs">
              The first row must contain column names. Up to {info.data?.maxRows ?? 5000} rows per
              file.
            </p>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <p className="text-muted-foreground text-sm">
              <strong className="text-foreground">{fileName}</strong>: choose which column holds
              each field.
            </p>
            {info.isPending ? (
              <Skeleton role="status" aria-label="Loading" className="h-32 w-full" />
            ) : (
              info.data?.fields.map((f) => (
                <div key={f.key} className="grid items-center gap-2 sm:grid-cols-[14rem_1fr]">
                  <Label htmlFor={`map-${f.key}`}>
                    {f.label}
                    {f.required && ' *'}
                  </Label>
                  <Select
                    value={mapping[f.key] || NONE}
                    onValueChange={(v) =>
                      setMapping((m) => ({ ...m, [f.key]: v === NONE ? '' : v }))
                    }
                  >
                    <SelectTrigger id={`map-${f.key}`} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Don’t import</SelectItem>
                      {header.map((h) => (
                        <SelectItem key={h} value={h}>
                          {h}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))
            )}
            <DialogFooter>
              <Button variant="outline" onClick={reset}>
                Choose another file
              </Button>
              <Button disabled={busy || missingRequired} onClick={() => void run(true)}>
                {busy ? 'Checking…' : 'Check file'}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 2 && result && (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm" role="status">
              {result.errorCount === 0 ? (
                <>
                  <CheckCircle2 className="size-4 text-success-soft-foreground" aria-hidden /> All{' '}
                  {result.total} rows are valid.
                </>
              ) : (
                <>
                  <TriangleAlert className="size-4 text-warning-soft-foreground" aria-hidden />{' '}
                  {result.errorCount} problem{result.errorCount === 1 ? '' : 's'} found in{' '}
                  {result.total - result.validRows} of {result.total} rows. Fix the file and upload
                  it again.
                </>
              )}
            </p>
            {result.errors.length > 0 && (
              <div className="max-h-52 overflow-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Row</TableHead>
                      <TableHead>Field</TableHead>
                      <TableHead>Problem</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.errors.map((e, i) => (
                      <TableRow key={i}>
                        <TableCell className="tabular-nums">{e.row}</TableCell>
                        <TableCell>{e.field}</TableCell>
                        <TableCell>{e.message}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {result.errorCount === 0 && result.preview.length > 0 && (
              <div className="max-h-52 overflow-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {Object.keys(result.preview[0]!)
                        .filter((k) => result.preview[0]![k] !== undefined)
                        .map((k) => (
                          <TableHead key={k}>{k}</TableHead>
                        ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.preview.map((row, i) => (
                      <TableRow key={i}>
                        {Object.entries(row)
                          .filter(([, v]) => v !== undefined)
                          .map(([k, v]) => (
                            <TableCell key={k}>{v ?? '—'}</TableCell>
                          ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={reset}>
                Start over
              </Button>
              <Button disabled={busy || result.errorCount > 0} onClick={() => void run(false)}>
                {busy ? 'Importing…' : `Import ${result.total} ${type}`}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 3 && result && (
          <div className="space-y-3 text-center" role="status">
            <CheckCircle2 className="mx-auto size-10 text-success-soft-foreground" aria-hidden />
            <p className="font-medium">
              Imported {result.created} {type}
            </p>
            <DialogFooter>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
