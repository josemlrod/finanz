import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createFileItemStore } from "~/lib/plaid/item-store.server";
import type { PlaidItem } from "~/lib/plaid/types";

function makeItem(itemId: string): PlaidItem {
  return {
    itemId,
    accessToken: `encrypted-${itemId}`,
    institutionId: `institution-${itemId}`,
    institutionName: `Institution ${itemId}`,
    cursor: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    health: {
      state: "ok",
      errorCode: null,
      message: null,
    },
  };
}

const userId = "user_test";

describe("createFileItemStore", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("serializes concurrent updates across store instances", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "finanz-item-store-"));
    const firstStore = createFileItemStore(tempDir);
    const secondStore = createFileItemStore(tempDir);
    const items = Array.from({ length: 20 }, (_, index) =>
      makeItem(`item-${index}`),
    );

    await Promise.all(
      items.map((item, index) =>
        (index % 2 === 0 ? firstStore : secondStore).save(userId, item),
      ),
    );

    expect(await firstStore.list(userId)).toHaveLength(items.length);
  });

  test("isolates Items with the same ID between users", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "finanz-item-store-"));
    const store = createFileItemStore(tempDir);
    const firstUserId = "user_first";
    const secondUserId = "user_second";
    const firstItem = {
      ...makeItem("item_shared"),
      institutionName: "First User Bank",
    };
    const secondItem = {
      ...makeItem("item_shared"),
      institutionName: "Second User Bank",
    };

    await store.save(firstUserId, firstItem);
    await store.save(secondUserId, secondItem);

    expect(await store.list(firstUserId)).toEqual([firstItem]);
    expect(await store.list(secondUserId)).toEqual([secondItem]);

    await store.setCursor(firstUserId, firstItem.itemId, "first-cursor");
    expect((await store.get(firstUserId, firstItem.itemId))?.cursor).toBe(
      "first-cursor",
    );
    expect((await store.get(secondUserId, secondItem.itemId))?.cursor).toBeNull();

    await store.remove(firstUserId, firstItem.itemId);
    expect(await store.get(firstUserId, firstItem.itemId)).toBeNull();
    expect(await store.get(secondUserId, secondItem.itemId)).toEqual(secondItem);
  });
});
