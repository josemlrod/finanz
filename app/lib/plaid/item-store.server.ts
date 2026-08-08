import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createKeyedLock } from "~/lib/plaid/async-lock.server";
import type { ItemStore, PlaidItem } from "~/lib/plaid/types";

const withFileLock = createKeyedLock<string>();

interface ItemsFile {
  byUser: Record<string, PlaidItem[]>;
}

async function readItemsFile(filePath: string): Promise<ItemsFile> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as ItemsFile | { items: PlaidItem[] };
    if ("byUser" in parsed) {
      return parsed;
    }
    // Legacy single-user format — treat as unscoped data (not returned for any user).
    return { byUser: {} };
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return { byUser: {} };
    }
    throw error;
  }
}

async function writeItemsFile(filePath: string, data: ItemsFile): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(data, null, 2), "utf8");
  await rename(tmpPath, filePath);
}

function itemsForUser(data: ItemsFile, userId: string): PlaidItem[] {
  return data.byUser[userId] ?? [];
}

export function createFileItemStore(dataDir = ".data"): ItemStore {
  const filePath = path.join(dataDir, "items.json");

  return {
    async save(userId, item) {
      await withFileLock(filePath, async () => {
        const data = await readItemsFile(filePath);
        const items = itemsForUser(data, userId);
        const index = items.findIndex(
          (existing) => existing.itemId === item.itemId,
        );
        if (index >= 0) {
          items[index] = item;
        } else {
          items.push(item);
        }
        data.byUser[userId] = items;
        await writeItemsFile(filePath, data);
      });
    },

    async list(userId) {
      return withFileLock(filePath, async () => {
        const data = await readItemsFile(filePath);
        return [...itemsForUser(data, userId)];
      });
    },

    async get(userId, itemId) {
      return withFileLock(filePath, async () => {
        const data = await readItemsFile(filePath);
        return itemsForUser(data, userId).find((item) => item.itemId === itemId) ?? null;
      });
    },

    async setCursor(userId, itemId, cursor) {
      await withFileLock(filePath, async () => {
        const data = await readItemsFile(filePath);
        const items = itemsForUser(data, userId);
        const item = items.find((existing) => existing.itemId === itemId);
        if (!item) {
          throw new Error(`Item not found: ${itemId}`);
        }
        item.cursor = cursor;
        data.byUser[userId] = items;
        await writeItemsFile(filePath, data);
      });
    },

    async remove(userId, itemId) {
      await withFileLock(filePath, async () => {
        const data = await readItemsFile(filePath);
        data.byUser[userId] = itemsForUser(data, userId).filter(
          (item) => item.itemId !== itemId,
        );
        await writeItemsFile(filePath, data);
      });
    },
  };
}
