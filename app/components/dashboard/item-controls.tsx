import { SignOutButton } from '@clerk/react-router';
import { Building2, ChevronDown, LogOut } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useFetcher } from 'react-router';
import { PlaidLinkButton } from '~/components/plaid-link';
import type { LinkedAccount } from '~/lib/plaid/types';
import type { DashboardItemData } from './item-panel';
import { RefreshTransactionsButton } from './refresh-transactions-button';

function formatMoney(amount: number | null, currency: string | null): string {
  if (amount === null) return 'Unavailable';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency ?? 'USD',
  }).format(amount);
}

function RefreshBalancesButton({
  itemId,
  disabled,
}: {
  itemId: string;
  disabled: boolean;
}) {
  const fetcher = useFetcher<{ accounts?: LinkedAccount[]; error?: string }>();
  const isRefreshing = fetcher.state !== 'idle';

  return (
    <div>
      <fetcher.Form method='post' action='/api/plaid/refresh-balances'>
        <input type='hidden' name='itemId' value={itemId} />
        <button
          type='submit'
          disabled={disabled || isRefreshing}
          className='rounded-md px-2.5 py-2 text-[11px] text-zinc-400 transition-colors duration-200 ease-out hover:bg-white/[0.06] hover:text-white disabled:opacity-50'
        >
          {isRefreshing ? 'Refreshing...' : 'Refresh balances'}
        </button>
      </fetcher.Form>
      {fetcher.data?.error ? (
        <p className='mt-1 text-[10px] text-rose-300' role='alert'>
          {fetcher.data.error}
        </p>
      ) : null}
    </div>
  );
}

export function ItemControls({ items }: { items: DashboardItemData[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <div ref={rootRef} className='relative'>
      <button
        type='button'
        aria-haspopup='dialog'
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className='flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-zinc-400 transition-colors duration-200 ease-out hover:bg-white/5 hover:text-white'
      >
        <Building2 className='size-3.5' />
        Items
        <ChevronDown
          className={`size-3 transition-transform duration-200 ease-out ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open ? (
        <div
          role='dialog'
          aria-label='Items and Linked Accounts'
          className='absolute right-0 top-[calc(100%+8px)] z-30 max-h-[min(75vh,620px)] w-[min(92vw,380px)] origin-top-right overflow-y-auto rounded-2xl border border-white/10 bg-[#17171b] p-2 shadow-2xl shadow-black/50'
        >
          <div className='px-3 pb-2 pt-1 text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-600'>
            Items and Linked Accounts
          </div>
          {items.length === 0 ? (
            <p className='px-3 py-5 text-xs text-zinc-500'>
              No Items connected yet.
            </p>
          ) : (
            <div className='space-y-2'>
              {items.map((item) => {
                const healthy = item.health.state === 'ok';
                const readable =
                  healthy || item.health.state === 'consent_expiring';
                const canReconnect =
                  item.health.state === 'reauth_required' ||
                  item.health.state === 'consent_expiring';

                return (
                  <section
                    key={item.itemId}
                    className='rounded-xl border border-white/[0.08] bg-black/15 p-3'
                  >
                    <div className='flex items-start justify-between gap-3'>
                      <div>
                        <p className='text-xs font-medium text-zinc-200'>
                          {item.institutionName}
                        </p>
                        <p
                          className={`mt-1 text-[10px] ${healthy ? 'text-emerald-400' : 'text-amber-300'}`}
                        >
                          {healthy ? 'Item healthy' : item.health.message}
                        </p>
                      </div>
                      {canReconnect ? (
                        <PlaidLinkButton
                          itemId={item.itemId}
                          className='rounded-md bg-amber-400/10 px-2.5 py-1.5 text-[10px] text-amber-200 transition-colors duration-200 ease-out hover:bg-amber-400/15 disabled:opacity-50'
                        />
                      ) : null}
                    </div>

                    <ul className='mt-3 divide-y divide-white/[0.06] border-y border-white/[0.06]'>
                      {item.accounts.map((account) => (
                        <li
                          key={account.accountId}
                          className='flex items-center justify-between gap-3 py-2.5 text-[11px]'
                        >
                          <span className='min-w-0 truncate text-zinc-400'>
                            {account.name}
                            {account.mask ? ` ••••${account.mask}` : ''}
                          </span>
                          <span className='shrink-0 tabular-nums text-zinc-300'>
                            {formatMoney(
                              account.currentBalance,
                              account.isoCurrencyCode,
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>

                    <div className='mt-2 flex flex-wrap items-center gap-1'>
                      <RefreshTransactionsButton
                        itemId={item.itemId}
                        label='Refresh Transactions'
                        disabled={!readable}
                        className='rounded-md px-2.5 py-2 text-[11px] text-zinc-400 transition-colors duration-200 ease-out hover:bg-white/[0.06] hover:text-white disabled:opacity-50'
                      />
                      <RefreshBalancesButton
                        itemId={item.itemId}
                        disabled={!readable}
                      />
                    </div>
                  </section>
                );
              })}
            </div>
          )}

          <div className='mt-2 flex items-center justify-between border-t border-white/[0.08] px-2 pt-2'>
            <PlaidLinkButton className='rounded-lg px-3 py-2 text-xs text-indigo-300 transition-colors duration-200 ease-out hover:bg-indigo-400/10 hover:text-indigo-200 disabled:opacity-50'>
              Connect Item
            </PlaidLinkButton>
            <SignOutButton redirectUrl='/sign-in'>
              <button
                type='button'
                className='flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-zinc-500 transition-colors duration-200 ease-out hover:bg-white/5 hover:text-white'
              >
                <LogOut className='size-3.5' /> Sign out
              </button>
            </SignOutButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}
