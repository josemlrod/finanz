import type { Transaction } from './plaid/types.ts';
import {
  currentDateString,
  dashboardMonthBoundary,
  formatCategoryLabel,
  formatMonthLabel,
  monthSpendSummary,
  transactionCategoryKey,
  type DashboardMonthBoundary,
  type MonthSpendSummary,
} from './transactions';

const CATEGORY_COLORS = [
  '#818cf8',
  '#34d399',
  '#fb7185',
  '#fbbf24',
  '#38bdf8',
  '#c084fc',
  '#a1a1aa',
];

export type DashboardCategory = {
  key: string;
  label: string;
  total: number;
  previousTotal: number;
  deltaAmount: number;
  deltaPct: number | null;
  color: string;
};

export type CumulativeSpendingPoint = {
  day: number;
  total: number;
};

export type DashboardInsights = {
  headline: string;
  summary: string;
  goodTitle: string;
  goodDetail: string;
  watchTitle: string;
  watchDetail: string;
  alertDetail: string;
  watchCategory: string | null;
};

export type DashboardModel = {
  month: string;
  monthLabel: string;
  shortMonthLabel: string;
  previousMonthLabel: string;
  boundary: DashboardMonthBoundary;
  summary: MonthSpendSummary;
  categories: DashboardCategory[];
  currentCumulative: CumulativeSpendingPoint[];
  previousCumulative: CumulativeSpendingPoint[];
  insights: DashboardInsights;
  transactions: Transaction[];
};

function roundMoney(value: number): number {
  return Number(value.toFixed(2));
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

function categoryColor(key: string): string {
  const hash = [...key].reduce((total, character) => {
    return (total * 31 + character.charCodeAt(0)) >>> 0;
  }, 0);
  return CATEGORY_COLORS[hash % CATEGORY_COLORS.length];
}

function spendingTotalsByCategory(
  transactions: Transaction[],
  startDate: string,
  endDate: string,
): Record<string, number> {
  const totals: Record<string, number> = {};

  for (const transaction of transactions) {
    if (transaction.amount <= 0) continue;
    if (transaction.date < startDate || transaction.date > endDate) continue;

    const key = transactionCategoryKey(transaction);
    totals[key] = (totals[key] ?? 0) + transaction.amount;
  }

  return Object.fromEntries(
    Object.entries(totals).map(([key, total]) => [key, roundMoney(total)]),
  );
}

function buildCategories(
  currentTotals: Record<string, number>,
  previousTotals: Record<string, number>,
): DashboardCategory[] {
  const keys = new Set([
    ...Object.keys(currentTotals),
    ...Object.keys(previousTotals),
  ]);

  return [...keys]
    .map((key) => {
      const total = currentTotals[key] ?? 0;
      const previousTotal = previousTotals[key] ?? 0;
      return {
        key,
        label:
          key === 'uncategorized'
            ? 'Uncategorized'
            : formatCategoryLabel(key),
        total,
        previousTotal,
        deltaAmount: roundMoney(total - previousTotal),
        deltaPct:
          previousTotal === 0
            ? null
            : roundMoney(((total - previousTotal) / previousTotal) * 100),
        color: categoryColor(key),
      };
    })
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

function cumulativeSpending(
  transactions: Transaction[],
  month: string,
  throughDay: number,
): CumulativeSpendingPoint[] {
  const daily = new Map<number, number>();

  for (const transaction of transactions) {
    if (transaction.amount <= 0 || !transaction.date.startsWith(`${month}-`)) {
      continue;
    }

    const day = Number(transaction.date.slice(8, 10));
    if (day > throughDay) continue;
    daily.set(day, (daily.get(day) ?? 0) + transaction.amount);
  }

  let total = 0;
  return Array.from({ length: throughDay }, (_, index) => {
    const day = index + 1;
    total += daily.get(day) ?? 0;
    return { day, total: roundMoney(total) };
  });
}

function buildInsights(
  summary: MonthSpendSummary,
  categories: DashboardCategory[],
  isCurrentMonth: boolean,
): DashboardInsights {
  const period = isCurrentMonth ? 'so far this month' : 'for the full month';

  if (!summary.hasPreviousData) {
    const topCategory = categories[0];
    return {
      headline: `A clear view of ${summary.monthLabel}`,
      summary: `You spent ${formatCurrency(summary.total)} ${period}. A prior month of stored Transactions is needed for a complete comparison.`,
      goodTitle: topCategory
        ? `${topCategory.label} is your largest category`
        : 'No spending recorded',
      goodDetail: topCategory
        ? `${formatCurrency(topCategory.total)} of spending is in ${topCategory.label.toLowerCase()}.`
        : 'There are no stored outflows inside this month boundary.',
      watchTitle: 'Comparison unavailable',
      watchDetail: 'No stored Transactions represent the previous month.',
      alertDetail: 'Connect more history to unlock category comparisons.',
      watchCategory: null,
    };
  }

  const difference = summary.deltaAmount;
  const isLower = difference <= 0;
  const good = [...categories]
    .filter((category) => category.deltaAmount < 0)
    .sort((a, b) => a.deltaAmount - b.deltaAmount)[0];
  const watch = [...categories]
    .filter((category) => category.deltaAmount > 0)
    .sort((a, b) => b.deltaAmount - a.deltaAmount)[0];
  const topCategory = categories[0];

  return {
    headline: isLower
      ? `Spending is ${formatCurrency(Math.abs(difference))} lower`
      : `Spending is ${formatCurrency(difference)} higher`,
    summary: `${summary.monthLabel} is ${isLower ? 'below' : 'above'} the comparable previous-month period, with ${formatCurrency(summary.total)} spent ${period}.`,
    goodTitle: good
      ? `${good.label} moved in the right direction`
      : 'Spending reductions are limited',
    goodDetail: good
      ? `${formatCurrency(Math.abs(good.deltaAmount))} less than the comparable previous-month period.`
      : 'No active category is below its previous-month comparison.',
    watchTitle: watch
      ? `${watch.label} is the category to watch`
      : `${topCategory?.label ?? 'Spending'} is holding steady`,
    watchDetail: watch
      ? `${formatCurrency(watch.deltaAmount)} above its previous-month comparison.`
      : 'No active category is above its previous-month comparison.',
    alertDetail: watch
      ? `${watch.deltaPct === null ? 'New spending' : `${Math.abs(watch.deltaPct).toFixed(0)}% higher`} in ${watch.label.toLowerCase()}.`
      : 'No category increase needs attention.',
    watchCategory: watch?.key ?? null,
  };
}

export function buildDashboardModel(
  transactions: Transaction[],
  month: string,
  today: string = currentDateString(),
): DashboardModel {
  const boundary = dashboardMonthBoundary(month, today);
  const summary = monthSpendSummary(transactions, month, today);
  const currentTotals = spendingTotalsByCategory(
    transactions,
    boundary.startDate,
    boundary.endDate,
  );
  const previousTotals = spendingTotalsByCategory(
    transactions,
    boundary.comparisonStartDate,
    boundary.comparisonEndDate,
  );
  const categories = buildCategories(currentTotals, previousTotals);
  const monthLabel = formatMonthLabel(month);

  return {
    month,
    monthLabel,
    shortMonthLabel: monthLabel.split(' ')[0],
    previousMonthLabel: formatMonthLabel(boundary.previousMonth).split(' ')[0],
    boundary,
    summary,
    categories,
    currentCumulative: cumulativeSpending(
      transactions,
      month,
      boundary.throughDay,
    ),
    previousCumulative: cumulativeSpending(
      transactions,
      boundary.previousMonth,
      boundary.comparisonThroughDay,
    ),
    insights: buildInsights(summary, categories, boundary.isCurrentMonth),
    transactions: transactions
      .filter(
        (transaction) =>
          transaction.amount > 0 &&
          transaction.date >= boundary.startDate &&
          transaction.date <= boundary.endDate,
      )
      .sort((a, b) => {
        const byDate = b.date.localeCompare(a.date);
        return byDate || a.transactionId.localeCompare(b.transactionId);
      }),
  };
}
