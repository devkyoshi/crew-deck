import { Check, Minus } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { COMPARISON, formatPrice, type PlanInfo } from '@/lib/plans';
import { cn } from '@/lib/utils';

/** Side-by-side plan table. Used on the pricing page, in sign-up and on the plan page. */
export function PlanComparison({ plans, current }: { plans: PlanInfo[]; current?: string | null }) {
  return (
    <div className="bg-card overflow-x-auto rounded-2xl border">
      <Table>
        <caption className="sr-only">Compare plans</caption>
        <TableHeader>
          <TableRow>
            <TableHead className="w-64">
              <span className="sr-only">Feature</span>
            </TableHead>
            {plans.map((p) => (
              <TableHead
                key={p.key}
                scope="col"
                className={cn('min-w-36', p.key === current && 'text-primary')}
              >
                <span className="block text-base font-semibold">{p.name}</span>
                <span className="text-muted-foreground block text-xs font-normal">
                  {p.priceCents
                    ? `${formatPrice(p.priceCents)} per person / month`
                    : formatPrice(p.priceCents)}
                  {p.key === current ? ' · your plan' : ''}
                </span>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {COMPARISON.map((row) => (
            <TableRow key={row.label}>
              <TableCell scope="row" className="font-medium">
                {row.label}
              </TableCell>
              {plans.map((p) => {
                const v = row.value(p);
                const no = v === 'Not included';
                return (
                  <TableCell key={p.key} className={cn(no && 'text-muted-foreground')}>
                    {v === 'Included' ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Check className="size-4 text-emerald-600" aria-hidden /> Included
                      </span>
                    ) : no ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Minus className="size-4" aria-hidden /> Not included
                      </span>
                    ) : (
                      v
                    )}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
