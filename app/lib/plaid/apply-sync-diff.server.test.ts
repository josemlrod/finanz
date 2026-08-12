import { describe, expect, test } from "bun:test";
import type { SyncDiff, Transaction } from "~/lib/plaid/types";
import { applySyncDiff } from "./apply-sync-diff.server";

const itemId = "item_test";

function makeTransaction(
  overrides: Partial<Transaction> & Pick<Transaction, "transactionId">,
): Transaction {
  return {
    itemId,
    accountId: "acct_1",
    amount: 12.34,
    date: "2026-07-01",
    name: "Coffee Shop",
    merchantName: "Coffee Shop",
    pending: false,
    personalFinanceCategory: {
      primary: "FOOD_AND_DRINK",
      detailed: "FOOD_AND_DRINK_COFFEE",
      confidenceLevel: "VERY_HIGH",
    },
    categoryIconUrl: null,
    logoUrl: null,
    website: null,
    isoCurrencyCode: "USD",
    ...overrides,
  };
}

describe("applySyncDiff", () => {
  test("upserts added and modified transactions", () => {
    const pending = makeTransaction({
      transactionId: "tx_pending",
      pending: true,
      amount: 15,
    });

    let bucket = applySyncDiff({}, { added: [pending], modified: [], removed: [] });
    expect(bucket.tx_pending?.pending).toBe(true);

    const posted = makeTransaction({
      transactionId: "tx_posted",
      pending: false,
      amount: 15,
    });

    bucket = applySyncDiff(bucket, {
      added: [posted],
      modified: [],
      removed: ["tx_pending"],
    });

    expect(bucket.tx_pending).toBeUndefined();
    expect(bucket.tx_posted?.pending).toBe(false);
  });

  test("is idempotent when replaying the same diff", () => {
    const transaction = makeTransaction({ transactionId: "tx_1" });
    const diff: SyncDiff = {
      added: [transaction],
      modified: [],
      removed: [],
    };

    const first = applySyncDiff({}, diff);
    const second = applySyncDiff(first, diff);

    expect(second).toEqual(first);
  });
});
