import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SyncDiff, Transaction } from "~/lib/plaid/types";
import {
  applySyncDiff,
  createFileTransactionStore,
} from "./transaction-store.server";

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

describe("createFileTransactionStore", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  async function createStore() {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "finanz-tx-store-"));
    return createFileTransactionStore(tempDir);
  }

  test("added transactions appear in list", async () => {
    const store = await createStore();
    const transaction = makeTransaction({ transactionId: "tx_1" });

    await store.applySync(itemId, {
      added: [transaction],
      modified: [],
      removed: [],
    });

    const transactions = await store.list(itemId);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toEqual(transaction);
  });

  test("modified replaces an existing transaction by transactionId", async () => {
    const store = await createStore();
    const original = makeTransaction({
      transactionId: "tx_1",
      amount: 10,
      pending: true,
    });

    await store.applySync(itemId, {
      added: [original],
      modified: [],
      removed: [],
    });

    const updated = makeTransaction({
      transactionId: "tx_1",
      amount: 12.5,
      pending: false,
    });

    await store.applySync(itemId, {
      added: [],
      modified: [updated],
      removed: [],
    });

    const transactions = await store.list(itemId);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]?.amount).toBe(12.5);
    expect(transactions[0]?.pending).toBe(false);
  });

  test("removed deletes transactions from list", async () => {
    const store = await createStore();
    const keep = makeTransaction({ transactionId: "tx_keep" });
    const remove = makeTransaction({ transactionId: "tx_remove" });

    await store.applySync(itemId, {
      added: [keep, remove],
      modified: [],
      removed: [],
    });

    await store.applySync(itemId, {
      added: [],
      modified: [],
      removed: ["tx_remove"],
    });

    const transactions = await store.list(itemId);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]?.transactionId).toBe("tx_keep");
  });

  test("list returns [] for an unknown item", async () => {
    const store = await createStore();

    expect(await store.list("unknown_item")).toEqual([]);
  });

  test("list returns transactions sorted by date descending", async () => {
    const store = await createStore();
    const older = makeTransaction({
      transactionId: "tx_old",
      date: "2026-06-01",
    });
    const newer = makeTransaction({
      transactionId: "tx_new",
      date: "2026-07-15",
    });

    await store.applySync(itemId, {
      added: [older, newer],
      modified: [],
      removed: [],
    });

    const transactions = await store.list(itemId);
    expect(transactions.map((tx) => tx.transactionId)).toEqual([
      "tx_new",
      "tx_old",
    ]);
  });

  test("a second applySync builds on persisted state from the first", async () => {
    const store = await createStore();
    const pending = makeTransaction({
      transactionId: "tx_pending",
      pending: true,
    });

    await store.applySync(itemId, {
      added: [pending],
      modified: [],
      removed: [],
    });

    const posted = makeTransaction({
      transactionId: "tx_posted",
      pending: false,
    });

    await store.applySync(itemId, {
      added: [posted],
      modified: [],
      removed: ["tx_pending"],
    });

    const transactions = await store.list(itemId);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]?.transactionId).toBe("tx_posted");
    expect(transactions[0]?.pending).toBe(false);
  });

  test("serializes concurrent updates across store instances", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "finanz-tx-store-"));
    const firstStore = createFileTransactionStore(tempDir);
    const secondStore = createFileTransactionStore(tempDir);
    const transactions = Array.from({ length: 20 }, (_, index) =>
      makeTransaction({ transactionId: `tx-${index}` }),
    );

    await Promise.all(
      transactions.map((transaction, index) =>
        (index % 2 === 0 ? firstStore : secondStore).applySync(itemId, {
          added: [transaction],
          modified: [],
          removed: [],
        }),
      ),
    );

    expect(await firstStore.list(itemId)).toHaveLength(transactions.length);
  });
});
