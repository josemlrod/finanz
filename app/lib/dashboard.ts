import type { ChartConfig } from '~/components/ui/chart';
import type { Transaction } from './plaid/types.ts';
import {
  buildCategoryChartConfig,
  buildMonthlyChartConfig,
  currentDateString,
  dailySpendingByCategory,
  monthSpendSummary,
  previousYearMonth,
  toCategoryData,
  totalsByCategory,
  transactionsForCategory,
  type DailySpendingRow,
  type MonthSpendSummary,
  type TransactionCategoryDatum,
} from './transactions';

export type DashboardModel = {
  month: string;
  summary: MonthSpendSummary;
  categoryData: TransactionCategoryDatum[];
  categoryChartConfig: ChartConfig;
  daily: {
    data: DailySpendingRow[];
    seriesKeys: string[];
    chartConfig: ChartConfig;
    monthLabel: string;
    hasSpending: boolean;
  };
  transactionsForCategory: (categoryKey: string) => Transaction[];
};

function dayOfMonth(date: string) {
  return Number(date.slice(8, 10));
}

export function buildDashboardModel(
  transactions: Transaction[],
  today: string = currentDateString(),
): DashboardModel {
  const month = today.slice(0, 7);

  const summary = monthSpendSummary(transactions, month, today);

  // A throughDay past the previous month's end filters nothing, so no clamping needed.
  const previousTotals = totalsByCategory(
    transactions,
    previousYearMonth(month),
    dayOfMonth(today),
  );
  const categoryData = toCategoryData(
    totalsByCategory(transactions, month),
    previousTotals,
  );
  const categoryChartConfig = buildCategoryChartConfig(categoryData);

  const { data, seriesKeys, monthLabel } = dailySpendingByCategory(
    transactions,
    month,
  );
  const chartConfig = buildMonthlyChartConfig(
    seriesKeys.filter((key) => key !== 'other'),
  );
  const hasSpending = data.some((row) =>
    seriesKeys.some((key) => Number(row[key]) > 0),
  );

  return {
    month,
    summary,
    categoryData,
    categoryChartConfig,
    daily: {
      data,
      seriesKeys,
      chartConfig,
      monthLabel,
      hasSpending,
    },
    transactionsForCategory: (categoryKey: string) =>
      transactionsForCategory(transactions, month, categoryKey),
  };
}
