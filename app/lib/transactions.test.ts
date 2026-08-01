import { describe, expect, it } from 'bun:test';
import type { Transaction } from './plaid/types.ts';
import {
  monthSpendSummary,
  previousYearMonth,
  toCategoryData,
  totalsByCategory,
  transactionsForCategory,
} from './transactions.ts';

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

describe('previousYearMonth', () => {
  it('returns the prior month for a normal month', () => {
    expect(previousYearMonth('2026-07')).toBe('2026-06');
  });

  it('rolls January back to December of the previous year', () => {
    expect(previousYearMonth('2026-01')).toBe('2025-12');
  });
});

describe('totalsByCategory', () => {
  const transactions = [
    makeTransaction({
      transactionId: 't1',
      amount: 10,
      date: '2026-07-01',
      personalFinanceCategory: {
        primary: 'FOOD_AND_DRINK',
        detailed: 'FOOD_AND_DRINK_RESTAURANT',
        confidenceLevel: null,
      },
    }),
    makeTransaction({
      transactionId: 't2',
      amount: 20,
      date: '2026-07-15',
      personalFinanceCategory: {
        primary: 'TRAVEL',
        detailed: 'TRAVEL_FLIGHTS',
        confidenceLevel: null,
      },
    }),
    makeTransaction({
      transactionId: 't3',
      amount: 5,
      date: '2026-06-30',
      personalFinanceCategory: {
        primary: 'FOOD_AND_DRINK',
        detailed: 'FOOD_AND_DRINK_RESTAURANT',
        confidenceLevel: null,
      },
    }),
    makeTransaction({
      transactionId: 't4',
      amount: -50,
      date: '2026-07-10',
    }),
    makeTransaction({
      transactionId: 't5',
      amount: 99,
      date: '2026-07-20',
      personalFinanceCategory: null,
    }),
  ];

  it('filters by month when provided', () => {
    expect(totalsByCategory(transactions, '2026-07')).toEqual({
      FOOD_AND_DRINK: 10,
      TRAVEL: 20,
    });
  });

  it('includes all transactions when month is omitted', () => {
    expect(totalsByCategory(transactions)).toEqual({
      FOOD_AND_DRINK: 15,
      TRAVEL: 20,
    });
  });

  it('filters by throughDay when provided', () => {
    expect(totalsByCategory(transactions, '2026-07', 10)).toEqual({
      FOOD_AND_DRINK: 10,
    });
  });

  it('excludes inflows and null categories', () => {
    expect(totalsByCategory(transactions, '2026-07')).not.toHaveProperty(
      'undefined',
    );
    expect(totalsByCategory(transactions, '2026-07').FOOD_AND_DRINK).toBe(10);
    expect(Object.keys(totalsByCategory(transactions, '2026-07'))).toHaveLength(
      2,
    );
  });
});

describe('monthSpendSummary', () => {
  it('uses same-day cutoff for the previous month in the current month', () => {
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

    const summary = monthSpendSummary(transactions, '2026-07', '2026-07-15');

    expect(summary.total).toBe(100);
    expect(summary.previousTotal).toBe(40);
    expect(summary.hasPreviousData).toBe(true);
    expect(summary.deltaAmount).toBe(60);
    expect(summary.deltaPct).toBe(150);
    expect(summary.monthLabel).toBe('July 2026');
  });

  it('compares full months for a past month', () => {
    const transactions = [
      makeTransaction({
        transactionId: 'jun-1',
        amount: 200,
        date: '2026-06-15',
      }),
      makeTransaction({
        transactionId: 'may-1',
        amount: 100,
        date: '2026-05-10',
      }),
    ];

    const summary = monthSpendSummary(transactions, '2026-06', '2026-07-01');

    expect(summary.total).toBe(200);
    expect(summary.previousTotal).toBe(100);
    expect(summary.deltaPct).toBe(100);
  });

  it('clamps the previous-month cutoff when the day exceeds that month length', () => {
    const transactions = [
      makeTransaction({
        transactionId: 'jul-31',
        amount: 310,
        date: '2026-07-31',
      }),
      makeTransaction({
        transactionId: 'jun-30',
        amount: 30,
        date: '2026-06-30',
      }),
      makeTransaction({
        transactionId: 'jun-31-skip',
        amount: 999,
        date: '2026-06-29',
      }),
    ];

    const summary = monthSpendSummary(transactions, '2026-07', '2026-07-31');

    expect(summary.total).toBe(310);
    expect(summary.previousTotal).toBe(1029);
    expect(summary.deltaAmount).toBe(-719);
  });

  it('returns null deltaPct when there is no previous-month data', () => {
    const transactions = [
      makeTransaction({
        transactionId: 'jul-1',
        amount: 50,
        date: '2026-07-01',
      }),
    ];

    const summary = monthSpendSummary(transactions, '2026-07', '2026-07-10');

    expect(summary.hasPreviousData).toBe(false);
    expect(summary.previousTotal).toBe(0);
    expect(summary.deltaPct).toBeNull();
  });

  it('returns null deltaPct when previousTotal is zero but data exists', () => {
    const transactions = [
      makeTransaction({
        transactionId: 'jul-1',
        amount: 50,
        date: '2026-07-05',
      }),
      makeTransaction({
        transactionId: 'jun-refund',
        amount: -25,
        date: '2026-06-01',
      }),
    ];

    const summary = monthSpendSummary(transactions, '2026-07', '2026-07-10');

    expect(summary.hasPreviousData).toBe(true);
    expect(summary.previousTotal).toBe(0);
    expect(summary.deltaPct).toBeNull();
  });
});

describe('transactionsForCategory', () => {
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

  it('filters by category, month, and outflows only', () => {
    const result = transactionsForCategory(
      transactions,
      '2026-07',
      'food_and_drink',
    );

    expect(result.map((t) => t.transactionId)).toEqual(['a', 'b']);
  });

  it('sorts by date descending', () => {
    const result = transactionsForCategory(
      transactions,
      '2026-07',
      'food_and_drink',
    );

    expect(result[0]?.date).toBe('2026-07-20');
    expect(result[1]?.date).toBe('2026-07-10');
  });
});

describe('toCategoryData', () => {
  it('populates previousTotal and deltaPct from previous totals', () => {
    const current = { FOOD_AND_DRINK: 150, TRAVEL: 50 };
    const previous = { FOOD_AND_DRINK: 100, TRAVEL: 0 };

    const data = toCategoryData(current, previous);

    expect(data[0]).toMatchObject({
      key: 'food_and_drink',
      total: 150,
      previousTotal: 100,
      deltaPct: 50,
    });
    expect(data[1]).toMatchObject({
      key: 'travel',
      total: 50,
      previousTotal: 0,
      deltaPct: null,
    });
  });
});
