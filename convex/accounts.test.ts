import { afterAll, describe, expect, test } from "bun:test";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = {
  "./_generated/api.js": () => import("./_generated/api.js"),
  "./accounts.ts": () => import("./accounts"),
  "./items.ts": () => import("./items"),
  "./users.ts": () => import("./users"),
};

const secret = "expected-secret";
const firstUserId = "user_first";
const secondUserId = "user_second";

function makeItem(itemId: string) {
  return {
    itemId,
    accessToken: `encrypted-${itemId}`,
    institutionId: `institution-${itemId}`,
    institutionName: `Institution ${itemId}`,
    cursor: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    health: {
      state: "ok" as const,
      errorCode: null,
      message: null,
    },
  };
}

function makeAccount(itemId: string, accountId: string) {
  return {
    accountId,
    itemId,
    name: `Account ${accountId}`,
    officialName: null,
    type: "depository",
    subtype: "checking",
    mask: "1234",
    currentBalance: 100,
    availableBalance: 90,
    isoCurrencyCode: "USD",
    updatedAt: "2026-07-02T00:00:00.000Z",
  };
}

async function upsertUser(t: ReturnType<typeof convexTest>, clerkUserId: string) {
  return t.mutation(api.users.upsert, {
    userId: clerkUserId,
    secret,
  });
}

describe("accounts", () => {
  const original = process.env.CONVEX_INTERNAL_SECRET;

  test("replaceForItem replaces the full snapshot and list returns user-scoped accounts", async () => {
    process.env.CONVEX_INTERNAL_SECRET = secret;
    const t = convexTest(schema, modules);
    await upsertUser(t, firstUserId);

    const item = makeItem("item-1");
    await t.mutation(api.items.save, {
      userId: firstUserId,
      secret,
      item,
    });

    const initialAccounts = [
      makeAccount(item.itemId, "account-1"),
      makeAccount(item.itemId, "account-2"),
    ];
    await t.mutation(api.accounts.replaceForItem, {
      userId: firstUserId,
      secret,
      itemId: item.itemId,
      accounts: initialAccounts,
    });

    const listed = await t.query(api.accounts.list, {
      userId: firstUserId,
      secret,
    });
    expect(listed).toHaveLength(2);
    expect(listed.map((account) => account.accountId).sort()).toEqual([
      "account-1",
      "account-2",
    ]);
    expect(listed[0]?.updatedAt).toBe("2026-07-02T00:00:00.000Z");
    expect(listed[1]?.updatedAt).toBe("2026-07-02T00:00:00.000Z");

    const replacementAccounts = [makeAccount(item.itemId, "account-3")];
    await t.mutation(api.accounts.replaceForItem, {
      userId: firstUserId,
      secret,
      itemId: item.itemId,
      accounts: replacementAccounts,
    });

    const replaced = await t.query(api.accounts.list, {
      userId: firstUserId,
      secret,
    });
    expect(replaced).toHaveLength(1);
    expect(replaced[0]?.accountId).toBe("account-3");
  });

  test("isolates accounts between users", async () => {
    process.env.CONVEX_INTERNAL_SECRET = secret;
    const t = convexTest(schema, modules);
    await upsertUser(t, firstUserId);
    await upsertUser(t, secondUserId);

    const firstItem = makeItem("item-first");
    const secondItem = makeItem("item-second");

    await t.mutation(api.items.save, {
      userId: firstUserId,
      secret,
      item: firstItem,
    });
    await t.mutation(api.items.save, {
      userId: secondUserId,
      secret,
      item: secondItem,
    });

    await t.mutation(api.accounts.replaceForItem, {
      userId: firstUserId,
      secret,
      itemId: firstItem.itemId,
      accounts: [makeAccount(firstItem.itemId, "account-first")],
    });
    await t.mutation(api.accounts.replaceForItem, {
      userId: secondUserId,
      secret,
      itemId: secondItem.itemId,
      accounts: [makeAccount(secondItem.itemId, "account-second")],
    });

    expect(
      await t.query(api.accounts.list, { userId: firstUserId, secret }),
    ).toHaveLength(1);
    expect(
      await t.query(api.accounts.list, { userId: secondUserId, secret }),
    ).toHaveLength(1);
  });

  test("replaceForItem throws when the item is missing", async () => {
    process.env.CONVEX_INTERNAL_SECRET = secret;
    const t = convexTest(schema, modules);
    await upsertUser(t, firstUserId);

    await expect(
      t.mutation(api.accounts.replaceForItem, {
        userId: firstUserId,
        secret,
        itemId: "missing-item",
        accounts: [makeAccount("missing-item", "account-1")],
      }),
    ).rejects.toThrow("Item not found: missing-item");
  });

  test("rejects requests with an invalid secret", async () => {
    process.env.CONVEX_INTERNAL_SECRET = secret;
    const t = convexTest(schema, modules);
    await upsertUser(t, firstUserId);

    await expect(
      t.query(api.accounts.list, { userId: firstUserId, secret: "wrong-secret" }),
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
