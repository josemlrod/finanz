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
  it('uses one current-month boundary for every model section', () => {
    const transactions = [
      makeTransaction({
        transactionId: 'current-included',
        amount: 100,
        date: '2026-08-15',
      }),
      makeTransaction({
        transactionId: 'current-future',
        amount: 50,
        date: '2026-08-16',
      }),
      makeTransaction({
        transactionId: 'previous-included',
        amount: 40,
        date: '2026-07-15',
      }),
      makeTransaction({
        transactionId: 'previous-late',
        amount: 60,
        date: '2026-07-16',
      }),
    ];

    const model = buildDashboardModel(transactions, '2026-08', '2026-08-15');

    expect(model.boundary.endDate).toBe('2026-08-15');
    expect(model.boundary.comparisonEndDate).toBe('2026-07-15');
    expect(model.summary.total).toBe(100);
    expect(model.summary.previousTotal).toBe(40);
    expect(model.categories[0]).toMatchObject({
      total: 100,
      previousTotal: 40,
      deltaAmount: 60,
      deltaPct: 150,
    });
    expect(model.currentCumulative).toHaveLength(15);
    expect(model.currentCumulative.at(-1)?.total).toBe(100);
    expect(model.previousCumulative).toHaveLength(15);
    expect(model.previousCumulative.at(-1)?.total).toBe(40);
    expect(model.transactions.map((transaction) => transaction.transactionId)).toEqual([
      'current-included',
    ]);
  });

  it('uses complete selected and previous months throughout a historical model', () => {
    const transactions = [
      makeTransaction({
        transactionId: 'april-last-day',
        amount: 200,
        date: '2026-04-30',
      }),
      makeTransaction({
        transactionId: 'march-last-day',
        amount: 100,
        date: '2026-03-31',
      }),
    ];

    const model = buildDashboardModel(transactions, '2026-04', '2026-08-15');

    expect(model.boundary.endDate).toBe('2026-04-30');
    expect(model.boundary.comparisonEndDate).toBe('2026-03-31');
    expect(model.summary.total).toBe(200);
    expect(model.summary.previousTotal).toBe(100);
    expect(model.categories[0]).toMatchObject({
      total: 200,
      previousTotal: 100,
      deltaPct: 100,
    });
    expect(model.currentCumulative).toHaveLength(30);
    expect(model.currentCumulative.at(-1)?.total).toBe(200);
    expect(model.previousCumulative).toHaveLength(31);
    expect(model.previousCumulative.at(-1)?.total).toBe(100);
    expect(model.transactions[0]?.transactionId).toBe('april-last-day');
  });

  it('includes uncategorized outflows so category totals reconcile to spending', () => {
    const model = buildDashboardModel(
      [
        makeTransaction({
          transactionId: 'categorized',
          amount: 30,
          date: '2026-08-10',
        }),
        makeTransaction({
          transactionId: 'uncategorized',
          amount: 20,
          date: '2026-08-11',
          personalFinanceCategory: null,
        }),
        makeTransaction({
          transactionId: 'refund',
          amount: -10,
          date: '2026-08-12',
        }),
      ],
      '2026-08',
      '2026-08-15',
    );

    expect(model.summary.total).toBe(50);
    expect(model.categories.reduce((sum, category) => sum + category.total, 0)).toBe(
      50,
    );
    expect(model.categories.find((category) => category.key === 'uncategorized')).toMatchObject({
      label: 'Uncategorized',
      total: 20,
    });
  });

  it('keeps categories that fell to zero visible for deltas and insights', () => {
    const model = buildDashboardModel(
      [
        makeTransaction({
          transactionId: 'previous-only',
          amount: 75,
          date: '2026-07-10',
        }),
      ],
      '2026-08',
      '2026-08-15',
    );

    expect(model.categories[0]).toMatchObject({
      key: 'food_and_drink',
      total: 0,
      previousTotal: 75,
      deltaAmount: -75,
      deltaPct: -100,
    });
    expect(model.insights.goodTitle).toContain('Food and drink');
  });
});
