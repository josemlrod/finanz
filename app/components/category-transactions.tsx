import { X } from 'lucide-react';

import { Button } from '~/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';
import type { Transaction } from '~/lib/plaid/types';

type CategoryTransactionsProps = {
  categoryKey: string;
  categoryLabel: string;
  transactions: Transaction[];
  onClose: () => void;
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatTransactionDate(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(parsed);
}

function getDisplayName(transaction: Transaction) {
  return transaction.merchantName ?? transaction.name;
}

function getInitial(name: string) {
  const trimmed = name.trim();
  return trimmed.charAt(0).toUpperCase() || '?';
}

export function CategoryTransactions({
  categoryKey: _categoryKey,
  categoryLabel,
  transactions,
  onClose,
}: CategoryTransactionsProps) {
  const total = transactions.reduce(
    (sum, transaction) => sum + transaction.amount,
    0,
  );

  return (
    <Card className='flex flex-col'>
      <CardHeader className='pb-2'>
        <CardTitle>{categoryLabel}</CardTitle>
        <CardDescription>
          {transactions.length} transaction
          {transactions.length === 1 ? '' : 's'} · {formatCurrency(total)}
        </CardDescription>
        <CardAction>
          <Button
            type='button'
            variant='ghost'
            size='icon-sm'
            aria-label='Close category transactions'
            onClick={onClose}
          >
            <X />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className='flex-1'>
        {transactions.length === 0 ? (
          <p className='text-sm text-muted-foreground'>
            No transactions in this category this month.
          </p>
        ) : (
          <ul className='divide-y divide-border'>
            {transactions.map((transaction) => {
              const displayName = getDisplayName(transaction);

              return (
                <li
                  key={transaction.transactionId}
                  className='flex items-center gap-3 py-3 first:pt-0 last:pb-0'
                >
                  {transaction.logoUrl ? (
                    <img
                      src={transaction.logoUrl}
                      alt=''
                      className='size-8 shrink-0 rounded-full bg-background object-contain'
                    />
                  ) : (
                    <div
                      aria-hidden
                      className='flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground'
                    >
                      {getInitial(displayName)}
                    </div>
                  )}
                  <div className='min-w-0 flex-1'>
                    <div className='flex items-center gap-2'>
                      <p className='truncate font-medium'>{displayName}</p>
                      {transaction.pending ? (
                        <span className='shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground'>
                          Pending
                        </span>
                      ) : null}
                    </div>
                    <p className='text-xs text-muted-foreground'>
                      {formatTransactionDate(transaction.date)}
                    </p>
                  </div>
                  <p className='shrink-0 font-medium tabular-nums'>
                    {formatCurrency(transaction.amount)}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
