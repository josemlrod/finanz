import { afterAll, describe, expect, test } from "bun:test";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = {
  "./_generated/api.js": () => import("./_generated/api.js"),
  "./items.ts": () => import("./items"),
  "./transactions.ts": () => import("./transactions"),
  "./users.ts": () => import("./users"),
};

const secret = "expected-secret";
const firstUserId = "user_first";
const secondUserId = "user_second";
const itemId = "item-1";

function makeItem(itemIdValue: string) {
  return {
    itemId: itemIdValue,
    accessToken: `encrypted-${itemIdValue}`,
    institutionId: `institution-${itemIdValue}`,
    institutionName: `Institution ${itemIdValue}`,
    cursor: null,
    createdAt: "2026-07-01T00:00:00.000Z",
  };
}

function makeTransaction(
  overrides: Partial<{
    transactionId: string;
    itemId: string;
    amount: number;
    date: string;
    pending: boolean;
  }> = {},
) {
  return {
    transactionId: "tx_1",
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

async function upsertUser(t: ReturnType<typeof convexTest>, clerkUserId: string) {
  return t.mutation(api.users.upsert, {
    userId: clerkUserId,
    secret,
  });
}

async function seedItem(t: ReturnType<typeof convexTest>, clerkUserId: string) {
  await upsertUser(t, clerkUserId);
  await t.mutation(api.items.save, {
    userId: clerkUserId,
    secret,
    item: makeItem(itemId),
  });
}

describe("transactions", () => {
  const original = process.env.CONVEX_INTERNAL_SECRET;

  test("applySync upserts added and modified transactions and removes deleted ones", async () => {
    process.env.CONVEX_INTERNAL_SECRET = secret;
    const t = convexTest(schema, modules);
    await seedItem(t, firstUserId);

    const pending = makeTransaction({
      transactionId: "tx_pending",
      pending: true,
      amount: 15,
    });

    await t.mutation(api.transactions.applySync, {
      userId: firstUserId,
      secret,
      itemId,
      diff: { added: [pending], modified: [], removed: [] },
    });

    const posted = makeTransaction({
      transactionId: "tx_posted",
      pending: false,
      amount: 15,
    });

    await t.mutation(api.transactions.applySync, {
      userId: firstUserId,
      secret,
      itemId,
      diff: {
        added: [posted],
        modified: [],
        removed: ["tx_pending"],
      },
    });

    const transactions = await t.query(api.transactions.list, {
      userId: firstUserId,
      secret,
      itemId,
    });

    expect(transactions).toHaveLength(1);
    expect(transactions[0]?.transactionId).toBe("tx_posted");
    expect(transactions[0]?.pending).toBe(false);
  });

  test("modified replaces an existing transaction by transactionId", async () => {
    process.env.CONVEX_INTERNAL_SECRET = secret;
    const t = convexTest(schema, modules);
    await seedItem(t, firstUserId);

    const original = makeTransaction({
      transactionId: "tx_1",
      amount: 10,
      pending: true,
    });

    await t.mutation(api.transactions.applySync, {
      userId: firstUserId,
      secret,
      itemId,
      diff: { added: [original], modified: [], removed: [] },
    });

    const updated = makeTransaction({
      transactionId: "tx_1",
      amount: 12.5,
      pending: false,
    });

    await t.mutation(api.transactions.applySync, {
      userId: firstUserId,
      secret,
      itemId,
      diff: { added: [], modified: [updated], removed: [] },
    });

    const transactions = await t.query(api.transactions.list, {
      userId: firstUserId,
      secret,
      itemId,
    });

    expect(transactions).toHaveLength(1);
    expect(transactions[0]?.amount).toBe(12.5);
    expect(transactions[0]?.pending).toBe(false);
  });

  test("scopes transaction identity to an item", async () => {
    process.env.CONVEX_INTERNAL_SECRET = secret;
    const t = convexTest(schema, modules);
    await seedItem(t, firstUserId);
    const secondItemId = "item-second";
    await t.mutation(api.items.save, {
      userId: firstUserId,
      secret,
      item: makeItem(secondItemId),
    });

    const firstTransaction = makeTransaction({ amount: 10 });
    const secondTransaction = makeTransaction({
      itemId: secondItemId,
      amount: 20,
    });

    await t.mutation(api.transactions.applySync, {
      userId: firstUserId,
      secret,
      itemId,
      diff: { added: [firstTransaction], modified: [], removed: [] },
    });
    await t.mutation(api.transactions.applySync, {
      userId: firstUserId,
      secret,
      itemId: secondItemId,
      diff: { added: [secondTransaction], modified: [], removed: [] },
    });
    await t.mutation(api.transactions.applySync, {
      userId: firstUserId,
      secret,
      itemId,
      diff: {
        added: [],
        modified: [makeTransaction({ amount: 15 })],
        removed: [],
      },
    });

    expect(
      await t.query(api.transactions.list, {
        userId: firstUserId,
        secret,
        itemId: secondItemId,
      }),
    ).toEqual([secondTransaction]);

    await t.mutation(api.transactions.applySync, {
      userId: firstUserId,
      secret,
      itemId,
      diff: { added: [], modified: [], removed: ["tx_1"] },
    });

    expect(
      await t.query(api.transactions.list, {
        userId: firstUserId,
        secret,
        itemId,
      }),
    ).toEqual([]);
    expect(
      await t.query(api.transactions.list, {
        userId: firstUserId,
        secret,
        itemId: secondItemId,
      }),
    ).toEqual([secondTransaction]);
  });

  test("list filters by date range using the by_userId_date index", async () => {
    process.env.CONVEX_INTERNAL_SECRET = secret;
    const t = convexTest(schema, modules);
    await seedItem(t, firstUserId);

    const older = makeTransaction({
      transactionId: "tx_old",
      date: "2026-06-01",
    });
    const newer = makeTransaction({
      transactionId: "tx_new",
      date: "2026-07-15",
    });

    await t.mutation(api.transactions.applySync, {
      userId: firstUserId,
      secret,
      itemId,
      diff: { added: [older, newer], modified: [], removed: [] },
    });

    const inRange = await t.query(api.transactions.list, {
      userId: firstUserId,
      secret,
      startDate: "2026-06-01",
      endDate: "2026-07-10",
    });
    expect(inRange.map((tx) => tx.transactionId)).toEqual(["tx_old"]);

    const all = await t.query(api.transactions.list, {
      userId: firstUserId,
      secret,
    });
    expect(all.map((tx) => tx.transactionId)).toEqual(["tx_new", "tx_old"]);
  });

  test("isolates transactions between users", async () => {
    process.env.CONVEX_INTERNAL_SECRET = secret;
    const t = convexTest(schema, modules);
    await seedItem(t, firstUserId);
    await upsertUser(t, secondUserId);
    await t.mutation(api.items.save, {
      userId: secondUserId,
      secret,
      item: makeItem("item-second"),
    });

    const firstTransaction = makeTransaction({
      transactionId: "tx_shared",
      amount: 10,
    });
    const secondTransaction = makeTransaction({
      transactionId: "tx_shared",
      itemId: "item-second",
      amount: 20,
    });

    await t.mutation(api.transactions.applySync, {
      userId: firstUserId,
      secret,
      itemId,
      diff: { added: [firstTransaction], modified: [], removed: [] },
    });
    await t.mutation(api.transactions.applySync, {
      userId: secondUserId,
      secret,
      itemId: "item-second",
      diff: { added: [secondTransaction], modified: [], removed: [] },
    });

    expect(
      await t.query(api.transactions.list, {
        userId: firstUserId,
        secret,
        itemId,
      }),
    ).toEqual([firstTransaction]);
    expect(
      await t.query(api.transactions.list, {
        userId: secondUserId,
        secret,
        itemId: "item-second",
      }),
    ).toEqual([secondTransaction]);
  });

  test("applySync throws when the item is missing", async () => {
    process.env.CONVEX_INTERNAL_SECRET = secret;
    const t = convexTest(schema, modules);
    await upsertUser(t, firstUserId);

    await expect(
      t.mutation(api.transactions.applySync, {
        userId: firstUserId,
        secret,
        itemId: "missing-item",
        diff: {
          added: [makeTransaction()],
          modified: [],
          removed: [],
        },
      }),
    ).rejects.toThrow("Item not found: missing-item");
  });

  test("rejects requests with an invalid secret", async () => {
    process.env.CONVEX_INTERNAL_SECRET = secret;
    const t = convexTest(schema, modules);
    await seedItem(t, firstUserId);

    await expect(
      t.query(api.transactions.list, {
        userId: firstUserId,
        secret: "wrong-secret",
      }),
    ).rejects.toThrow("Unauthorized: invalid internal secret");
  });

  afterAll(() => {
    if (original === undefined) {
      delete process.env.CONVEX_INTERNAL_SECRET;
    } else {
      process.env.CONVEX_INTERNAL_SECRET = original;
    }
  });
});
