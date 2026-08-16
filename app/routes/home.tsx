import { redirect, useFetcher, useSearchParams } from 'react-router';
import type { Route } from './+types/home';
import { AutoSync } from '~/components/dashboard/auto-sync';
import type { DashboardItemData } from '~/components/dashboard/item-panel';
import { SignalDashboard } from '~/components/signal-dashboard';
import { requirePageAuth } from '~/lib/auth.server';
import { buildDashboardModel } from '~/lib/dashboard';
import { env } from '~/lib/env.server';
import {
  getAccountStore,
  getItemStore,
  getTransactionStore,
} from '~/lib/plaid/wiring.server';
import { currentDateString, transactionMonths } from '~/lib/transactions';

export function meta(_args: Route.MetaArgs) {
  return [
    { title: 'Finanz' },
    { name: 'description', content: 'Personal finance dashboard' },
  ];
}

export async function loader(args: Route.LoaderArgs) {
  const { userId } = await requirePageAuth(args);
  const [items, accounts, transactions] = await Promise.all([
    getItemStore().list(userId),
    getAccountStore().list(userId),
    getTransactionStore().list(userId),
  ]);

  const accountsByItem = new Map<string, typeof accounts>();
  for (const account of accounts) {
    const itemAccounts = accountsByItem.get(account.itemId) ?? [];
    itemAccounts.push(account);
    accountsByItem.set(account.itemId, itemAccounts);
  }

  const transactionsByItem = new Map<string, typeof transactions>();
  for (const transaction of transactions) {
    const itemTransactions = transactionsByItem.get(transaction.itemId) ?? [];
    itemTransactions.push(transaction);
    transactionsByItem.set(transaction.itemId, itemTransactions);
  }

  const dashboardItems: DashboardItemData[] = items.map((item) => {
    const itemTransactions = transactionsByItem.get(item.itemId) ?? [];

    return {
      itemId: item.itemId,
      institutionId: item.institutionId,
      institutionName: item.institutionName,
      createdAt: item.createdAt,
      accounts: accountsByItem.get(item.itemId) ?? [],
      transactions: itemTransactions,
      health: item.health,
      status:
        item.cursor !== null || itemTransactions.length > 0
          ? ('populated' as const)
          : ('loading' as const),
    };
  });

  const today = currentDateString();
  const availableMonths = transactionMonths(transactions);
  const requestUrl = new URL(args.request.url);
  const requestedMonth = requestUrl.searchParams.get('month');
  if (requestedMonth && !availableMonths.includes(requestedMonth)) {
    requestUrl.searchParams.delete('month');
    throw redirect(`${requestUrl.pathname}${requestUrl.search}`);
  }
  const currentMonth = today.slice(0, 7);
  const selectedMonth =
    (requestedMonth && availableMonths.includes(requestedMonth)
      ? requestedMonth
      : null) ??
    (availableMonths.includes(currentMonth) ? currentMonth : null) ??
    availableMonths[0] ??
    currentMonth;

  return {
    items: dashboardItems,
    transactions,
    today,
    availableMonths,
    selectedMonth,
    isSandbox: env.PLAID_ENV === 'sandbox',
  };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const {
    items,
    transactions,
    today,
    availableMonths,
    selectedMonth,
    isSandbox,
  } = loaderData;
  const [, setSearchParams] = useSearchParams();
  const categoryFetcher = useFetcher<{
    error?: string;
    transactionId?: string;
    primary?: string | null;
  }>();
  const optimisticTransactionId = categoryFetcher.formData?.get('transactionId');
  const optimisticPrimary = categoryFetcher.formData?.get('primary');
  const optimisticTransactions = transactions.map((transaction) =>
    typeof optimisticTransactionId === 'string' &&
    transaction.transactionId === optimisticTransactionId &&
    typeof optimisticPrimary === 'string'
      ? {
          ...transaction,
          userCategoryPrimary: optimisticPrimary || null,
        }
      : transaction,
  );
  const model = buildDashboardModel(
    optimisticTransactions,
    selectedMonth,
    today,
  );

  function selectMonth(month: string) {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set('month', month);
        next.delete('category');
        return next;
      },
      { preventScrollReset: true },
    );
  }

  function changeTransactionCategory(
    transactionId: string,
    primary: string | null,
  ) {
    categoryFetcher.submit(
      { transactionId, primary: primary ?? '' },
      { method: 'post', action: '/api/transactions/category' },
    );
  }

  return (
    <>
      {items.map((item) => (
        <AutoSync
          key={item.itemId}
          itemId={item.itemId}
          enabled={item.status === 'loading' && item.health.state === 'ok'}
        />
      ))}
      <SignalDashboard
        key={model.month}
        model={model}
        availableMonths={availableMonths}
        items={items}
        isSandbox={isSandbox}
        onMonthChange={selectMonth}
        categoryMutationPending={categoryFetcher.state !== 'idle'}
        categoryMutationError={categoryFetcher.data?.error}
        onCategoryChange={changeTransactionCategory}
      />
    </>
  );
}
