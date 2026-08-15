import { ArrowLeft, ArrowRight, ReceiptText } from 'lucide-react';
import { useState } from 'react';

import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import type { Transaction } from '~/lib/plaid/types';
import { currentDateString, formatCategoryLabel } from '~/lib/transactions';
import { cn } from '~/lib/utils';

type Range = 'day' | 'week' | 'month';

type Period = {
  start: string;
  end: string;
  title: string;
  detail: string;
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value);
}

function parseDate(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function toDateString(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatShortDate(date: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(parseDate(date));
}

function getPeriod(range: Range, offset: number, today: string): Period {
  const month = today.slice(0, 7);
  const monthStart = `${month}-01`;
  const todayDate = parseDate(today);
  const year = todayDate.getFullYear();

  if (range === 'month') {
    return {
      start: monthStart,
      end: today,
      title: new Intl.DateTimeFormat('en-US', { month: 'long' }).format(
        todayDate,
      ),
      detail: `Month to date · ${year}`,
    };
  }

  const end = addDays(todayDate, offset * (range === 'week' ? 7 : 1));
  const endString = toDateString(end);

  if (range === 'day') {
    return {
      start: endString,
      end: endString,
      title: new Intl.DateTimeFormat('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      }).format(end),
      detail: `Daily statement · ${year}`,
    };
  }

  const startString = [
    toDateString(addDays(end, -6)),
    monthStart,
  ].sort()[1];

  return {
    start: startString,
    end: endString,
    title: `${formatShortDate(startString)}–${formatShortDate(endString)}`,
    detail: `Weekly statement · ${year}`,
  };
}

function formatAmount(amount: number) {
  if (amount > 0) return `−${formatCurrency(amount)}`;
  if (amount < 0) return `+${formatCurrency(Math.abs(amount))}`;
  return formatCurrency(0);
}

export function TransactionHistory({
  transactions,
}: {
  transactions: Transaction[];
}) {
  const [range, setRange] = useState<Range>('month');
  const [offset, setOffset] = useState(0);
  const today = currentDateString();
  const monthStart = `${today.slice(0, 7)}-01`;
  const period = getPeriod(range, offset, today);
  const visible = transactions
    .filter(
      (transaction) =>
        transaction.date >= period.start && transaction.date <= period.end,
    )
    .sort((a, b) => {
      const byDate = b.date.localeCompare(a.date);
      return byDate || a.transactionId.localeCompare(b.transactionId);
    });
  const outflows = visible.filter((transaction) => transaction.amount > 0);
  const totalSpent = outflows.reduce(
    (sum, transaction) => sum + transaction.amount,
    0,
  );
  const averagePurchase =
    outflows.length > 0 ? totalSpent / outflows.length : 0;
  const categoryCount = new Set(
    visible
      .map((transaction) => transaction.personalFinanceCategory?.primary)
      .filter(Boolean),
  ).size;
  const canGoBack = range !== 'month' && period.start > monthStart;
  const canGoForward = range !== 'month' && offset < 0;

  function selectRange(nextRange: Range) {
    setRange(nextRange);
    setOffset(0);
  }

  return (
    <Card className='h-[calc(100dvh-2rem)] min-h-[30rem] gap-0 overflow-hidden py-0 sm:min-h-[36rem]'>
      <div className='shrink-0 bg-muted/35 p-5 sm:p-6'>
        <div className='flex flex-wrap items-start justify-between gap-4'>
          <div className='flex gap-3'>
            <span className='flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-background'>
              <ReceiptText className='size-4' aria-hidden />
            </span>
            <div>
              <p className='text-xs text-muted-foreground'>{period.detail}</p>
              <h2 className='mt-1 font-heading text-xl font-semibold tracking-tight'>
                {period.title}
              </h2>
            </div>
          </div>

          <div
            className='flex rounded-lg border border-border bg-background p-0.5'
            aria-label='Transaction period'
          >
            {(['day', 'week', 'month'] as Range[]).map((value) => (
              <button
                key={value}
                type='button'
                onClick={() => selectRange(value)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors duration-200 ease-out',
                  range === value
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
                aria-pressed={range === value}
              >
                {value}
              </button>
            ))}
          </div>
        </div>

        <div className='mt-6 grid grid-cols-2 gap-4 border-t border-border pt-5 sm:grid-cols-4'>
          <div className='col-span-2 sm:col-span-1'>
            <p className='text-xs text-muted-foreground'>Total spent</p>
            <p className='mt-1 font-heading text-2xl font-semibold tabular-nums'>
              {formatCurrency(totalSpent)}
            </p>
          </div>
          <div>
            <p className='text-xs text-muted-foreground'>Transactions</p>
            <p className='mt-1 text-base font-medium tabular-nums'>
              {visible.length}
            </p>
          </div>
          <div>
            <p className='text-xs text-muted-foreground'>Average purchase</p>
            <p className='mt-1 text-base font-medium tabular-nums'>
              {formatCurrency(averagePurchase)}
            </p>
          </div>
          <div>
            <p className='text-xs text-muted-foreground'>Categories</p>
            <p className='mt-1 text-base font-medium tabular-nums'>
              {categoryCount}
            </p>
          </div>
        </div>
      </div>

      <div className='flex shrink-0 items-center justify-between border-y border-border px-4 py-2'>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          disabled={!canGoBack}
          onClick={() => setOffset((value) => value - 1)}
        >
          <ArrowLeft /> Previous
        </Button>
        <p className='hidden text-xs text-muted-foreground sm:block'>
          All linked accounts
        </p>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          disabled={!canGoForward}
          onClick={() => setOffset((value) => value + 1)}
        >
          Next <ArrowRight />
        </Button>
      </div>

      <div className='min-h-0 flex-1 overflow-auto overscroll-contain'>
        <table className='w-full min-w-[620px] text-left text-sm'>
          <thead className='sticky top-0 z-10 border-b border-border bg-card text-xs text-muted-foreground'>
            <tr>
              {range !== 'day' ? (
                <th className='w-28 px-5 py-3 font-normal'>Date</th>
              ) : null}
              <th className='px-5 py-3 font-normal'>Description</th>
              <th className='w-48 px-5 py-3 font-normal'>Category</th>
              <th className='w-32 px-5 py-3 text-right font-normal'>Amount</th>
            </tr>
          </thead>
          <tbody className='divide-y divide-border'>
            {visible.map((transaction) => {
              const merchant = transaction.merchantName ?? transaction.name;
              const category = transaction.personalFinanceCategory?.primary;
              const isInflow = transaction.amount < 0;

              return (
                <tr
                  key={transaction.transactionId}
                  className='transition-colors duration-200 ease-out hover:bg-muted/20'
                >
                  {range !== 'day' ? (
                    <td className='px-5 py-4 text-xs text-muted-foreground'>
                      {formatShortDate(transaction.date)}
                    </td>
                  ) : null}
                  <td className='px-5 py-4'>
                    <p className='font-medium'>{merchant}</p>
                    <p className='mt-0.5 max-w-72 truncate text-[11px] text-muted-foreground'>
                      {transaction.name}
                      {transaction.pending ? ' · Pending' : ''}
                    </p>
                  </td>
                  <td className='px-5 py-4 text-xs text-muted-foreground'>
                    {category ? formatCategoryLabel(category) : 'Uncategorized'}
                  </td>
                  <td
                    className={cn(
                      'px-5 py-4 text-right font-medium tabular-nums',
                      isInflow && 'text-emerald-600 dark:text-emerald-400',
                    )}
                  >
                    {formatAmount(transaction.amount)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {visible.length === 0 ? (
          <p className='py-12 text-center text-sm text-muted-foreground'>
            No statement activity for this period.
          </p>
        ) : null}
      </div>
    </Card>
  );
}
