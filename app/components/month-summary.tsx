import { TrendingDown, TrendingUp } from 'lucide-react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';
import type { MonthSpendSummary } from '~/lib/transactions';
import { cn } from '~/lib/utils';

type MonthSummaryProps = {
  summary: MonthSpendSummary;
};

function formatHeroCurrency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatComparisonCurrency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDeltaPct(pct: number) {
  const sign = pct > 0 ? '+' : pct < 0 ? '−' : '';
  return `${sign}${Math.abs(pct).toFixed(1)}%`;
}

function formatSignedDeltaAmount(amount: number) {
  const sign = amount > 0 ? '+' : amount < 0 ? '−' : '';
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(amount));
  return `(${sign}${formatted})`;
}

export function MonthSummary({ summary }: MonthSummaryProps) {
  const isIncrease = summary.deltaAmount > 0;

  return (
    <Card>
      <CardHeader className='pb-2'>
        <CardTitle>{summary.monthLabel}</CardTitle>
        <CardDescription>Total spent so far</CardDescription>
      </CardHeader>
      <CardContent>
        <div className='flex flex-col gap-2'>
          <div className='flex flex-wrap items-baseline gap-x-3 gap-y-1'>
            <p className='text-4xl font-bold tabular-nums'>
              {formatHeroCurrency(summary.total)}
            </p>
            {summary.deltaPct !== null && (
              <span
                className={cn(
                  'inline-flex items-center gap-1 text-sm font-medium',
                  isIncrease
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-emerald-600 dark:text-emerald-400',
                )}
              >
                {isIncrease ? (
                  <TrendingUp className='size-4' aria-hidden />
                ) : (
                  <TrendingDown className='size-4' aria-hidden />
                )}
                {formatDeltaPct(summary.deltaPct)}
                <span className='font-normal text-muted-foreground'>
                  {formatSignedDeltaAmount(summary.deltaAmount)}
                </span>
              </span>
            )}
          </div>
          <p className='text-sm text-muted-foreground'>
            {summary.hasPreviousData ? (
              <>
                vs {formatComparisonCurrency(summary.previousTotal)} by this
                point last month
              </>
            ) : (
              <>— no data for last month</>
            )}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
