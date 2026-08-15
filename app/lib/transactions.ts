import type { ChartConfig } from '~/components/ui/chart';
import type { Transaction } from './plaid/types.ts';

type TransactionCategoryTotals = Record<string, number>;

export type TransactionCategoryDatum = {
  key: string;
  category: string;
  total: number;
  previousTotal: number;
  deltaPct: number | null;
  fill: string;
};

export type DailySpendingRow = {
  day: string;
  date: string;
  [seriesKey: string]: string | number;
};

export type MonthSpendSummary = {
  total: number;
  previousTotal: number;
  hasPreviousData: boolean;
  deltaAmount: number;
  deltaPct: number | null;
  monthLabel: string;
};

export type DashboardPeriod = 'month' | 'last7' | 'end';

export type DashboardMonthBoundary = {
  month: string;
  previousMonth: string;
  isCurrentMonth: boolean;
  throughDay: number;
  comparisonThroughDay: number;
  startDate: string;
  endDate: string;
  comparisonStartDate: string;
  comparisonEndDate: string;
};

export type TransactionPeriodRange = {
  startDate: string;
  endDate: string;
};

const CATEGORY_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
];

const TOP_CATEGORY_LIMIT = 5;

export function formatCategoryLabel(category: string): string {
  const words = category.toLowerCase().split('_').join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function currentYearMonth() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function previousYearMonth(month: string): string {
  const [yearStr, monthStr] = month.split('-');
  let year = Number(yearStr);
  let m = Number(monthStr);

  m -= 1;
  if (m === 0) {
    m = 12;
    year -= 1;
  }

  return `${year}-${String(m).padStart(2, '0')}`;
}

export function currentDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dayOfMonth(date: string) {
  return Number(date.slice(8, 10));
}

function lastDayOfMonth(yearMonth: string) {
  const [year, month] = yearMonth.split('-').map(Number);
  return new Date(year, month, 0).getDate();
}

export function formatMonthLabel(yearMonth: string) {
  const [year, month] = yearMonth.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
}

export function isYearMonth(value: string): boolean {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return false;

  const [year] = value.split('-').map(Number);
  return year >= 1 && year <= 9999;
}

export function transactionMonths(transactions: Transaction[]): string[] {
  return [
    ...new Set(
      transactions
        .map((transaction) => transaction.date.slice(0, 7))
        .filter(isYearMonth),
    ),
  ].sort((a, b) => b.localeCompare(a));
}

export function dashboardMonthBoundary(
  month: string,
  today: string = currentDateString(),
): DashboardMonthBoundary {
  const previousMonth = previousYearMonth(month);
  const isCurrentMonth = today.startsWith(`${month}-`);
  const throughDay = isCurrentMonth
    ? dayOfMonth(today)
    : lastDayOfMonth(month);
  const comparisonThroughDay = isCurrentMonth
    ? Math.min(throughDay, lastDayOfMonth(previousMonth))
    : lastDayOfMonth(previousMonth);

  return {
    month,
    previousMonth,
    isCurrentMonth,
    throughDay,
    comparisonThroughDay,
    startDate: `${month}-01`,
    endDate: `${month}-${String(throughDay).padStart(2, '0')}`,
    comparisonStartDate: `${previousMonth}-01`,
    comparisonEndDate: `${previousMonth}-${String(comparisonThroughDay).padStart(2, '0')}`,
  };
}

function dateDaysBefore(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const result = new Date(Date.UTC(year, month - 1, day - days));
  return result.toISOString().slice(0, 10);
}

export function transactionPeriodRange(
  boundary: DashboardMonthBoundary,
  period: DashboardPeriod,
): TransactionPeriodRange {
  if (period === 'end') {
    return { startDate: boundary.endDate, endDate: boundary.endDate };
  }

  if (period === 'last7') {
    const sevenDayStart = dateDaysBefore(boundary.endDate, 6);
    return {
      startDate:
        sevenDayStart < boundary.startDate
          ? boundary.startDate
          : sevenDayStart,
      endDate: boundary.endDate,
    };
  }

  return { startDate: boundary.startDate, endDate: boundary.endDate };
}

export function transactionCategoryKey(transaction: Transaction): string {
  return (
    transaction.personalFinanceCategory?.primary.toLowerCase() ??
    'uncategorized'
  );
}

export function filterDashboardTransactions(
  transactions: Transaction[],
  boundary: DashboardMonthBoundary,
  period: DashboardPeriod,
  categoryKey: string | 'all',
  query: string,
): Transaction[] {
  const range = transactionPeriodRange(boundary, period);
  const normalizedQuery = query.trim().toLowerCase();

  return transactions
    .filter((transaction) => {
      if (transaction.amount <= 0) return false;
      if (transaction.date < range.startDate || transaction.date > range.endDate) {
        return false;
      }
      if (
        categoryKey !== 'all' &&
        transactionCategoryKey(transaction) !== categoryKey
      ) {
        return false;
      }
      if (!normalizedQuery) return true;

      return [
        transaction.merchantName,
        transaction.name,
        transaction.personalFinanceCategory?.primary,
        transaction.personalFinanceCategory?.detailed,
      ].some((value) => value?.toLowerCase().includes(normalizedQuery));
    })
    .sort((a, b) => {
      const byDate = b.date.localeCompare(a.date);
      return byDate || a.transactionId.localeCompare(b.transactionId);
    });
}

function formatDayLabel(date: string) {
  return String(Number(date.slice(8, 10)));
}

function daysInMonth(yearMonth: string) {
  const count = lastDayOfMonth(yearMonth);
  const days: string[] = [];

  for (let day = 1; day <= count; day++) {
    days.push(`${yearMonth}-${String(day).padStart(2, '0')}`);
  }

  return days;
}

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

function computeDeltaPct(current: number, previous: number) {
  if (previous === 0) return null;
  return roundMoney(((current - previous) / previous) * 100);
}

function sumOutflows(
  transactions: Transaction[],
  month: string,
  throughDay?: number,
) {
  let sum = 0;

  for (const t of transactions) {
    if (t.amount <= 0) continue;
    if (!t.date.startsWith(month)) continue;
    if (throughDay !== undefined && dayOfMonth(t.date) > throughDay) continue;
    sum += t.amount;
  }

  return roundMoney(sum);
}

export function totalsByCategory(
  transactions: Transaction[],
  month?: string,
  throughDay?: number,
) {
  const result: TransactionCategoryTotals = {};

  for (const t of transactions) {
    if (!t.personalFinanceCategory) continue;
    // Plaid signs outflows positive and inflows negative.
    if (t.amount <= 0) continue;
    if (month !== undefined && !t.date.startsWith(month)) continue;
    if (throughDay !== undefined && dayOfMonth(t.date) > throughDay) continue;

    const cat = t.personalFinanceCategory.primary;

    result[cat] = (result[cat] ?? 0) + t.amount;
  }

  return result;
}

export function toCategoryData(
  transactionCategoriesTotals: TransactionCategoryTotals,
  previousTotals?: TransactionCategoryTotals,
): TransactionCategoryDatum[] {
  return Object.entries(transactionCategoriesTotals)
    .sort(([, a], [, b]) => b - a)
    .map(([cat, total]) => {
      const key = cat.toLowerCase();
      const roundedTotal = roundMoney(total);
      const previousTotal = roundMoney(previousTotals?.[cat] ?? 0);

      return {
        key,
        category: formatCategoryLabel(cat),
        total: roundedTotal,
        previousTotal,
        deltaPct: computeDeltaPct(roundedTotal, previousTotal),
        fill: `var(--color-${key})`,
      };
    });
}

export function monthSpendSummary(
  transactions: Transaction[],
  month: string,
  today: string = currentDateString(),
): MonthSpendSummary {
  const boundary = dashboardMonthBoundary(month, today);
  const total = sumOutflows(transactions, month, boundary.throughDay);
  const previousTotal = sumOutflows(
    transactions,
    boundary.previousMonth,
    boundary.comparisonThroughDay,
  );
  const hasPreviousData = transactions.some((t) =>
    t.date.startsWith(boundary.previousMonth),
  );
  const deltaAmount = roundMoney(total - previousTotal);
  const deltaPct =
    !hasPreviousData || previousTotal === 0
      ? null
      : computeDeltaPct(total, previousTotal);

  return {
    total,
    previousTotal,
    hasPreviousData,
    deltaAmount,
    deltaPct,
    monthLabel: formatMonthLabel(month),
  };
}

export function transactionsForCategory(
  transactions: Transaction[],
  month: string,
  categoryKey: string,
  throughDay?: number,
): Transaction[] {
  return transactions
    .filter(
      (t) =>
        t.amount > 0 &&
        t.date.startsWith(month) &&
        (throughDay === undefined || dayOfMonth(t.date) <= throughDay) &&
        t.personalFinanceCategory?.primary.toLowerCase() === categoryKey,
    )
    .sort((a, b) => {
      const byDate = b.date.localeCompare(a.date);
      if (byDate !== 0) return byDate;
      return a.transactionId.localeCompare(b.transactionId);
    });
}

export function buildCategoryChartConfig(
  categories: TransactionCategoryDatum[],
): ChartConfig {
  return categories.reduce<ChartConfig>(
    (acc, { key, category }, index) => ({
      ...acc,
      [key]: {
        label: category,
        color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
      },
    }),
    {},
  );
}

function topCategoryKeys(
  totals: TransactionCategoryTotals,
  limit = TOP_CATEGORY_LIMIT,
) {
  return Object.entries(totals)
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit)
    .map(([cat]) => cat.toLowerCase());
}

export function dailySpendingByCategory(
  transactions: Transaction[],
  month: string = currentYearMonth(),
  throughDay?: number,
): { data: DailySpendingRow[]; seriesKeys: string[]; monthLabel: string } {
  const totals = totalsByCategory(transactions, month, throughDay);
  const topKeys = topCategoryKeys(totals);
  const seriesKeys = [...topKeys, 'other'];

  const buckets = new Map<string, Record<string, number>>();

  for (const t of transactions) {
    if (!t.personalFinanceCategory) continue;
    if (t.amount <= 0) continue;
    if (!t.date.startsWith(month)) continue;
    if (throughDay !== undefined && dayOfMonth(t.date) > throughDay) continue;

    const cat = t.personalFinanceCategory.primary.toLowerCase();
    const seriesKey = topKeys.includes(cat) ? cat : 'other';

    if (!buckets.has(t.date)) {
      buckets.set(
        t.date,
        Object.fromEntries(seriesKeys.map((key) => [key, 0])),
      );
    }

    const bucket = buckets.get(t.date)!;
    bucket[seriesKey] = (bucket[seriesKey] ?? 0) + t.amount;
  }

  const emptyAmounts = Object.fromEntries(seriesKeys.map((key) => [key, 0]));

  const data: DailySpendingRow[] = daysInMonth(month).map((date) => {
    const amounts = buckets.get(date) ?? emptyAmounts;

    return {
      day: formatDayLabel(date),
      date,
      ...Object.fromEntries(
        seriesKeys.map((key) => [
          key,
          Number((amounts[key] ?? 0).toFixed(2)),
        ]),
      ),
    };
  });

  return { data, seriesKeys, monthLabel: formatMonthLabel(month) };
}

export function buildMonthlyChartConfig(topKeys: string[]): ChartConfig {
  const config: ChartConfig = {};

  for (const [index, key] of topKeys.entries()) {
    config[key] = {
      label: formatCategoryLabel(key),
      color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
    };
  }

  config.other = {
    label: 'Other',
    color: 'var(--muted-foreground)',
  };

  return config;
}
