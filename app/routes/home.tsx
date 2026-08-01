import { useSearchParams } from 'react-router';
import type { Route } from './+types/home';
import { PlaidLinkButton } from '~/components/plaid-link';
import { type DashboardItemData } from '~/components/dashboard/item-panel';
import {
  getItemStore,
  getPlaidService,
  getTransactionStore,
} from '~/lib/plaid/wiring.server';
import { env } from '~/lib/env.server';
import { CategoryBarChart } from '~/components/category-bar-chart';
import { CategoryTransactions } from '~/components/category-transactions';
import { MonthSummary } from '~/components/month-summary';
import { SpendingAreaChart } from '~/components/spending-area-chart';
import { buildDashboardModel } from '~/lib/dashboard';

export function meta(_args: Route.MetaArgs) {
  return [
    { title: 'Finanz' },
    { name: 'description', content: 'Personal finance dashboard' },
  ];
}

export async function loader(_args: Route.LoaderArgs) {
  const plaid = getPlaidService();
  const items = await getItemStore().list();
  const transactionStore = getTransactionStore();

  const dashboardItems: DashboardItemData[] = await Promise.all(
    items.map(async (item) => {
      const transactions = await transactionStore.list(item.itemId);
      const { accounts, health } = await plaid.getAccountsSnapshot(item.itemId);

      return {
        itemId: item.itemId,
        institutionId: item.institutionId,
        institutionName: item.institutionName,
        createdAt: item.createdAt,
        accounts,
        transactions,
        health,
        status:
          transactions.length > 0
            ? ('populated' as const)
            : ('loading' as const),
      };
    }),
  );

  return { items: dashboardItems, isSandbox: env.PLAID_ENV === 'sandbox' };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { items, isSandbox } = loaderData;
  const [searchParams, setSearchParams] = useSearchParams();

  const transactions = items.flatMap((item) => item.transactions);

  const model = buildDashboardModel(transactions);

  const selectedDatum = model.categoryData.find(
    (datum) => datum.key === searchParams.get('category'),
  );

  function selectCategory(key: string | null) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (key) {
          next.set('category', key);
        } else {
          next.delete('category');
        }
        return next;
      },
      { preventScrollReset: true },
    );
  }

  return (
    <main className='mx-auto min-h-screen max-w-5xl px-4 py-10'>
      <header className='mb-8 flex flex-wrap items-center justify-between gap-4'>
        <div>
          <h1 className='text-2xl font-bold text-gray-900 dark:text-gray-100'>
            Finanz
          </h1>
          <p className='text-sm text-gray-500 dark:text-gray-400'>
            Personal finance{isSandbox ? ' — Plaid Sandbox' : ''}
          </p>
        </div>
        <PlaidLinkButton className='rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white' />
      </header>

      <div className='space-y-6'>
        <MonthSummary summary={model.summary} />
        {model.categoryData.length > 0 ? (
          <>
            <CategoryBarChart
              chartData={model.categoryData}
              chartConfig={model.categoryChartConfig}
              selectedKey={selectedDatum?.key ?? null}
              onSelectCategory={selectCategory}
            />
            {selectedDatum ? (
              <CategoryTransactions
                categoryKey={selectedDatum.key}
                categoryLabel={selectedDatum.category}
                transactions={model.transactionsForCategory(selectedDatum.key)}
                onClose={() => selectCategory(null)}
              />
            ) : null}
            {model.daily.hasSpending ? (
              <SpendingAreaChart
                chartData={model.daily.data}
                seriesKeys={model.daily.seriesKeys}
                chartConfig={model.daily.chartConfig}
                monthLabel={model.daily.monthLabel}
              />
            ) : null}
          </>
        ) : null}
      </div>
    </main>
  );
}
