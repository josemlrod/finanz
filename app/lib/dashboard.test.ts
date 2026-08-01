import { describe, expect, it } from 'bun:test';
import type { Transaction } from './plaid/types.ts';
import { buildDashboardModel } from './dashboard.ts';

function makeTransaction(
  overrides: Partial<Transaction> &
    Pick<Transaction, 'transactionId' | 'amount' | 'date'>,
): Transaction {
  return {
    itemId: 'item-1',
    accountId: 'acct-1',
    name: 'Test',
    merchantName: null,
    pending: false,
    personalFinanceCategory: {
      primary: 'FOOD_AND_DRINK',
      detailed: 'FOOD_AND_DRINK_RESTAURANT',
      confidenceLevel: null,
    },
    categoryIconUrl: null,
    logoUrl: null,
    website: null,
    isoCurrencyCode: 'USD',
    ...overrides,
  };
}

describe('buildDashboardModel', () => {
  const today = '2026-07-15';

  it('derives month from today and computes summary totals', () => {
    const transactions = [
      makeTransaction({
        transactionId: 'jul-1',
        amount: 100,
        date: '2026-07-15',
      }),
      makeTransaction({
        transactionId: 'jul-2',
        amount: 50,
        date: '2026-07-20',
      }),
      makeTransaction({
        transactionId: 'jun-1',
        amount: 40,
        date: '2026-06-10',
      }),
      makeTransaction({
        transactionId: 'jun-2',
        amount: 60,
        date: '2026-06-20',
      }),
      makeTransaction({
        transactionId: 'jun-3',
        amount: 999,
        date: '2026-06-25',
      }),
    ];

    const model = buildDashboardModel(transactions, today);

    expect(model.month).toBe('2026-07');
    expect(model.summary.total).toBe(100);
    expect(model.summary.previousTotal).toBe(40);
    expect(model.summary.hasPreviousData).toBe(true);
    expect(model.summary.deltaAmount).toBe(60);
    expect(model.summary.deltaPct).toBe(150);
    expect(model.summary.monthLabel).toBe('July 2026');
    expect(
      model
        .transactionsForCategory('food_and_drink')
        .map((transaction) => transaction.transactionId),
    ).toEqual(['jul-1']);
    expect(
      model.daily.data.find((row) => row.date === '2026-07-20')
        ?.food_and_drink,
    ).toBe(0);
  });

  it('builds categoryData sorted descending with previous totals and deltaPct', () => {
    const transactions = [
      makeTransaction({
        transactionId: 'food-jul',
        amount: 150,
        date: '2026-07-10',
        personalFinanceCategory: {
          primary: 'FOOD_AND_DRINK',
          detailed: 'FOOD_AND_DRINK_RESTAURANT',
          confidenceLevel: null,
        },
      }),
      makeTransaction({
        transactionId: 'travel-jul',
        amount: 50,
        date: '2026-07-12',
        personalFinanceCategory: {
          primary: 'TRAVEL',
          detailed: 'TRAVEL_FLIGHTS',
          confidenceLevel: null,
        },
      }),
      makeTransaction({
        transactionId: 'food-jun',
        amount: 100,
        date: '2026-06-05',
        personalFinanceCategory: {
          primary: 'FOOD_AND_DRINK',
          detailed: 'FOOD_AND_DRINK_RESTAURANT',
          confidenceLevel: null,
        },
      }),
      makeTransaction({
        transactionId: 'travel-jun',
        amount: 25,
        date: '2026-06-10',
        personalFinanceCategory: {
          primary: 'TRAVEL',
          detailed: 'TRAVEL_FLIGHTS',
          confidenceLevel: null,
        },
      }),
      makeTransaction({
        transactionId: 'inflow',
        amount: -50,
        date: '2026-07-08',
      }),
      makeTransaction({
        transactionId: 'no-cat',
        amount: 99,
        date: '2026-07-09',
        personalFinanceCategory: null,
      }),
    ];

    const model = buildDashboardModel(transactions, today);

    expect(model.categoryData).toHaveLength(2);
    expect(model.categoryData[0]).toMatchObject({
      key: 'food_and_drink',
      category: 'Food and drink',
      total: 150,
      previousTotal: 100,
      deltaPct: 50,
    });
    expect(model.categoryData[1]).toMatchObject({
      key: 'travel',
      category: 'Travel',
      total: 50,
      previousTotal: 25,
      deltaPct: 100,
    });
  });

  it('builds daily series with top-5 categories plus other and detects spending', () => {
    const categories = [
      'CAT_A',
      'CAT_B',
      'CAT_C',
      'CAT_D',
      'CAT_E',
      'CAT_F',
    ] as const;

    const transactions = categories.flatMap((cat, index) => [
      makeTransaction({
        transactionId: `${cat}-high`,
        amount: 100 - index,
        date: '2026-07-05',
        personalFinanceCategory: {
          primary: cat,
          detailed: `${cat}_DETAIL`,
          confidenceLevel: null,
        },
      }),
      makeTransaction({
        transactionId: `${cat}-low`,
        amount: 1,
        date: '2026-07-10',
        personalFinanceCategory: {
          primary: cat,
          detailed: `${cat}_DETAIL`,
          confidenceLevel: null,
        },
      }),
    ]);

    const model = buildDashboardModel(transactions, today);

    expect(model.daily.seriesKeys).toHaveLength(6);
    expect(model.daily.seriesKeys.slice(0, 5)).toEqual([
      'cat_a',
      'cat_b',
      'cat_c',
      'cat_d',
      'cat_e',
    ]);
    expect(model.daily.seriesKeys[5]).toBe('other');
    expect(model.daily.hasSpending).toBe(true);

    const dayFive = model.daily.data.find((row) => row.date === '2026-07-05');
    expect(dayFive?.cat_a).toBe(100);
    expect(dayFive?.other).toBe(95);
    expect(dayFive?.cat_f).toBeUndefined();
  });

  it('sets hasSpending false when the month has no outflows', () => {
    const transactions = [
      makeTransaction({
        transactionId: 'inflow',
        amount: -25,
        date: '2026-07-05',
      }),
      makeTransaction({
        transactionId: 'other-month',
        amount: 50,
        date: '2026-06-01',
      }),
    ];

    const model = buildDashboardModel(transactions, today);

    expect(model.categoryData).toHaveLength(0);
    expect(model.daily.hasSpending).toBe(false);
  });

  it('returns category transactions through today', () => {
    const transactions = [
      makeTransaction({
        transactionId: 'b',
        amount: 20,
        date: '2026-07-10',
        personalFinanceCategory: {
          primary: 'FOOD_AND_DRINK',
          detailed: 'FOOD_AND_DRINK_RESTAURANT',
          confidenceLevel: null,
        },
      }),
      makeTransaction({
        transactionId: 'a',
        amount: 10,
        date: '2026-07-20',
        personalFinanceCategory: {
          primary: 'FOOD_AND_DRINK',
          detailed: 'FOOD_AND_DRINK_RESTAURANT',
          confidenceLevel: null,
        },
      }),
      makeTransaction({
        transactionId: 'c',
        amount: 30,
        date: '2026-07-05',
        personalFinanceCategory: {
          primary: 'TRAVEL',
          detailed: 'TRAVEL_FLIGHTS',
          confidenceLevel: null,
        },
      }),
      makeTransaction({
        transactionId: 'd',
        amount: 5,
        date: '2026-06-01',
        personalFinanceCategory: {
          primary: 'FOOD_AND_DRINK',
          detailed: 'FOOD_AND_DRINK_RESTAURANT',
          confidenceLevel: null,
        },
      }),
      makeTransaction({
        transactionId: 'e',
        amount: -15,
        date: '2026-07-12',
        personalFinanceCategory: {
          primary: 'FOOD_AND_DRINK',
          detailed: 'FOOD_AND_DRINK_RESTAURANT',
          confidenceLevel: null,
        },
      }),
    ];

    const model = buildDashboardModel(transactions, today);
    const result = model.transactionsForCategory('food_and_drink');

    expect(result.map((t) => t.transactionId)).toEqual(['b']);
    expect(result[0]?.date).toBe('2026-07-10');
  });
});
