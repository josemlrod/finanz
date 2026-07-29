import { useEffect } from 'react';
import { useFetcher, useRevalidator } from 'react-router';
import { PlaidLinkButton } from '~/components/plaid-link';
import type { ItemHealth, LinkedAccount, Transaction } from '~/lib/plaid/types';
import { formatCategoryLabel } from '~/lib/transactions';
import { AutoSync } from './auto-sync';

export interface DashboardItemData {
  itemId: string;
  institutionId: string;
  institutionName: string;
  createdAt: string;
  accounts: LinkedAccount[];
  transactions: Transaction[];
  health: ItemHealth;
  status: 'loading' | 'populated';
}

interface ItemPanelProps {
  item: DashboardItemData;
}

function formatMoney(amount: number | null, currency: string | null): string {
  if (amount === null) {
    return '—';
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency ?? 'USD',
  }).format(amount);
}

function formatTransactionAmount(
  amount: number,
  currency: string | null,
): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency ?? 'USD',
    signDisplay: 'always',
  }).format(amount * -1);
}

export function ItemPanel({ item }: ItemPanelProps) {
  const syncFetcher = useFetcher<{ hasUpdates?: boolean; error?: string }>();
  const refreshFetcher = useFetcher<{
    accounts?: LinkedAccount[];
    error?: string;
  }>();
  const revalidator = useRevalidator();

  const accounts = refreshFetcher.data?.accounts ?? item.accounts;
  const isSyncing = syncFetcher.state !== 'idle';
  const isRefreshing = refreshFetcher.state !== 'idle';
  const needsReauth = item.health.state === 'reauth_required';
  const isBroken = needsReauth || item.health.state === 'error';

  useEffect(() => {
    if (syncFetcher.state === 'idle' && syncFetcher.data?.hasUpdates) {
      revalidator.revalidate();
    }
  }, [syncFetcher.state, syncFetcher.data, revalidator]);

  return (
    <section className='rounded-xl border p-6 shadow-sm'>
      <AutoSync
        itemId={item.itemId}
        enabled={item.status === 'loading' && !isBroken}
      />

      <div className='flex flex-wrap items-start justify-between gap-4'>
        <div>
          <h2 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
            {item.institutionName}
          </h2>
          <p className='text-sm text-gray-500 dark:text-gray-400'>
            Linked {new Date(item.createdAt).toLocaleDateString()}
          </p>
        </div>

        <div className='flex flex-wrap gap-2'>
          {(needsReauth || item.health.state === 'consent_expiring') && (
            <PlaidLinkButton
              itemId={item.itemId}
              className='rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-amber-600 disabled:opacity-50'
            />
          )}

          <syncFetcher.Form method='post' action='/api/plaid/sync'>
            <input type='hidden' name='itemId' value={item.itemId} />
            <button
              type='submit'
              disabled={isSyncing || isBroken}
              className='rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800'
            >
              {isSyncing ? 'Syncing…' : 'Sync transactions'}
            </button>
          </syncFetcher.Form>

          <refreshFetcher.Form
            method='post'
            action='/api/plaid/refresh-balances'
          >
            <input type='hidden' name='itemId' value={item.itemId} />
            <button
              type='submit'
              disabled={isRefreshing || isBroken}
              className='rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800'
            >
              {isRefreshing ? 'Refreshing…' : 'Refresh balances'}
            </button>
          </refreshFetcher.Form>
        </div>
      </div>

      {item.health.state !== 'ok' && (
        <div
          className={`mt-4 rounded-lg px-4 py-3 text-sm ${
            item.health.state === 'error'
              ? 'bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200'
              : 'bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100'
          }`}
        >
          {item.health.message}
          {item.health.errorCode && (
            <span className='ml-2 opacity-60'>({item.health.errorCode})</span>
          )}
        </div>
      )}

      {item.status === 'loading' && !isBroken && (
        <div className='mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100'>
          Connected — your bank is still sending transaction history. Sandbox
          returns this in seconds; a real bank can take a few minutes. Auto-sync
          is running; use Sync if needed.
        </div>
      )}

      {(syncFetcher.data?.error || refreshFetcher.data?.error) && (
        <div className='mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-200'>
          {syncFetcher.data?.error ?? refreshFetcher.data?.error}
        </div>
      )}

      <div className='mt-6'>
        <h3 className='mb-3 text-sm font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400'>
          Accounts
        </h3>
        {accounts.length === 0 ? (
          <p className='text-sm text-gray-500 dark:text-gray-400'>
            No accounts found.
          </p>
        ) : (
          <ul className='divide-y divide-gray-100 rounded-lg border border-gray-100 dark:divide-gray-800 dark:border-gray-800'>
            {accounts.map((account) => (
              <li
                key={account.accountId}
                className='flex items-center justify-between px-4 py-3'
              >
                <div>
                  <p className='font-medium text-gray-900 dark:text-gray-100'>
                    {account.name}
                    {account.mask ? ` ••••${account.mask}` : ''}
                  </p>
                  <p className='text-xs text-gray-500 dark:text-gray-400'>
                    {[account.type, account.subtype]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <div className='text-right'>
                  <p className='font-medium text-gray-900 dark:text-gray-100'>
                    {formatMoney(
                      account.currentBalance,
                      account.isoCurrencyCode,
                    )}
                  </p>
                  {account.availableBalance !== null &&
                    account.availableBalance !== account.currentBalance && (
                      <p className='text-xs text-gray-500 dark:text-gray-400'>
                        {formatMoney(
                          account.availableBalance,
                          account.isoCurrencyCode,
                        )}{' '}
                        available
                      </p>
                    )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className='mt-6'>
        <h3 className='mb-3 text-sm font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400'>
          Transactions
        </h3>
        {item.transactions.length === 0 ? (
          <p className='text-sm text-gray-500 dark:text-gray-400'>
            {item.status === 'loading'
              ? 'Waiting for transactions…'
              : 'No transactions in the last sync window.'}
          </p>
        ) : (
          <ul className='divide-y divide-gray-100 rounded-lg border border-gray-100 dark:divide-gray-800 dark:border-gray-800'>
            {item.transactions.map((transaction) => (
              <li
                key={transaction.transactionId}
                className='flex items-center justify-between px-4 py-3'
              >
                <div className='flex min-w-0 flex-1 items-center gap-3 pr-4'>
                  {transaction.logoUrl ? (
                    <img
                      src={transaction.logoUrl}
                      alt=''
                      className='size-8 shrink-0 rounded-full bg-white object-contain'
                    />
                  ) : (
                    transaction.categoryIconUrl && (
                      <img
                        src={transaction.categoryIconUrl}
                        alt=''
                        className='size-8 shrink-0 rounded-full'
                      />
                    )
                  )}
                  <div className='min-w-0'>
                    <p className='truncate font-medium text-gray-900 dark:text-gray-100'>
                      {transaction.merchantName ?? transaction.name}
                    </p>
                    <p className='text-xs text-gray-500 dark:text-gray-400'>
                      {transaction.date}
                      {transaction.pending ? ' · Pending' : ''}
                      {transaction.personalFinanceCategory
                        ? ` · ${formatCategoryLabel(transaction.personalFinanceCategory.primary)}`
                        : ''}
                    </p>
                  </div>
                </div>
                <p
                  className={`shrink-0 font-medium ${
                    transaction.amount > 0
                      ? 'text-gray-900 dark:text-gray-100'
                      : 'text-emerald-600 dark:text-emerald-400'
                  }`}
                >
                  {formatTransactionAmount(
                    transaction.amount,
                    transaction.isoCurrencyCode,
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
