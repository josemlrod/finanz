import { afterAll, describe, expect, test } from "bun:test";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = {
  "./_generated/api.js": () => import("./_generated/api.js"),
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

async function upsertUser(t: ReturnType<typeof convexTest>, clerkUserId: string) {
  return t.mutation(api.users.upsert, {
    userId: clerkUserId,
    secret,
  });
}

describe("items", () => {
  const original = process.env.CONVEX_INTERNAL_SECRET;

  test("save upserts by itemId and list returns user-scoped items", async () => {
    process.env.CONVEX_INTERNAL_SECRET = secret;
    const t = convexTest(schema, modules);
    await upsertUser(t, firstUserId);

    const item = makeItem("item-1");
    await t.mutation(api.items.save, {
      userId: firstUserId,
      secret,
      item,
    });

    const updatedItem = {
      ...item,
      institutionName: "Updated Bank",
      accessToken: "encrypted-updated",
    };
    await t.mutation(api.items.save, {
      userId: firstUserId,
      secret,
      item: updatedItem,
    });

    expect(await t.query(api.items.list, { userId: firstUserId, secret })).toEqual([
      updatedItem,
    ]);
    expect(await t.query(api.items.get, {
      userId: firstUserId,
      secret,
      itemId: item.itemId,
    })).toEqual(updatedItem);
  });

  test("isolates items between users", async () => {
    process.env.CONVEX_INTERNAL_SECRET = secret;
    const t = convexTest(schema, modules);
    await upsertUser(t, firstUserId);
    await upsertUser(t, secondUserId);

    const firstItem = {
      ...makeItem("item-first"),
      institutionName: "First User Bank",
    };
    const secondItem = {
      ...makeItem("item-second"),
      institutionName: "Second User Bank",
    };

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

    expect(await t.query(api.items.list, { userId: firstUserId, secret })).toEqual([
      firstItem,
    ]);
    expect(await t.query(api.items.list, { userId: secondUserId, secret })).toEqual([
      secondItem,
    ]);

    expect(
      await t.query(api.items.get, {
        userId: firstUserId,
        secret,
        itemId: secondItem.itemId,
      }),
    ).toBeNull();

    await t.mutation(api.items.setCursor, {
      userId: firstUserId,
      secret,
      itemId: firstItem.itemId,
      cursor: "first-cursor",
    });

    expect(
      (await t.query(api.items.get, {
        userId: firstUserId,
        secret,
        itemId: firstItem.itemId,
      }))?.cursor,
    ).toBe("first-cursor");
    expect(
      (await t.query(api.items.get, {
        userId: secondUserId,
        secret,
        itemId: secondItem.itemId,
      }))?.cursor,
    ).toBeNull();

    await t.mutation(api.items.remove, {
      userId: firstUserId,
      secret,
      itemId: firstItem.itemId,
    });

    expect(
      await t.query(api.items.get, {
        userId: firstUserId,
        secret,
        itemId: firstItem.itemId,
      }),
    ).toBeNull();
    expect(
      await t.query(api.items.get, {
        userId: secondUserId,
        secret,
        itemId: secondItem.itemId,
      }),
    ).toEqual(secondItem);
  });

  test("setHealth updates the stored item health", async () => {
    process.env.CONVEX_INTERNAL_SECRET = secret;
    const t = convexTest(schema, modules);
    await upsertUser(t, firstUserId);

    const item = makeItem("item-1");
    await t.mutation(api.items.save, {
      userId: firstUserId,
      secret,
      item,
    });

    const health = {
      state: "reauth_required" as const,
      errorCode: "ITEM_LOGIN_REQUIRED",
      message: "Sign in again",
    };
    await t.mutation(api.items.setHealth, {
      userId: firstUserId,
      secret,
      itemId: item.itemId,
      health,
    });

    expect(
      await t.query(api.items.get, {
        userId: firstUserId,
        secret,
        itemId: item.itemId,
      }),
    ).toEqual({
      ...item,
      health,
    });
  });

  test("setCursor throws when the item is missing", async () => {
    process.env.CONVEX_INTERNAL_SECRET = secret;
    const t = convexTest(schema, modules);
    await upsertUser(t, firstUserId);

    await expect(
      t.mutation(api.items.setCursor, {
        userId: firstUserId,
        secret,
        itemId: "missing-item",
        cursor: "cursor-1",
      }),
    ).rejects.toThrow("Item not found: missing-item");
  });

  test("rejects requests with an invalid secret", async () => {
    process.env.CONVEX_INTERNAL_SECRET = secret;
    const t = convexTest(schema, modules);
    await upsertUser(t, firstUserId);

    await expect(
      t.query(api.items.list, { userId: firstUserId, secret: "wrong-secret" }),
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
