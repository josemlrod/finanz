import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createKeyedLock } from "~/lib/plaid/async-lock.server";
import type { ItemStore, PlaidItem } from "~/lib/plaid/types";

const withFileLock = createKeyedLock<string>();

interface ItemsFile {
  items: PlaidItem[];
}

async function readItemsFile(filePath: string): Promise<ItemsFile> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as ItemsFile;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return { items: [] };
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

export function createFileItemStore(dataDir = ".data"): ItemStore {
  const filePath = path.join(dataDir, "items.json");

  return {
    async save(item) {
      await withFileLock(filePath, async () => {
        const data = await readItemsFile(filePath);
        const index = data.items.findIndex(
          (existing) => existing.itemId === item.itemId,
        );
        if (index >= 0) {
          data.items[index] = item;
        } else {
          data.items.push(item);
        }
        await writeItemsFile(filePath, data);
      });
    },

    async list() {
      return withFileLock(filePath, async () => {
        const data = await readItemsFile(filePath);
        return [...data.items];
      });
    },

    async get(itemId) {
      return withFileLock(filePath, async () => {
        const data = await readItemsFile(filePath);
        return data.items.find((item) => item.itemId === itemId) ?? null;
      });
    },

    async setCursor(itemId, cursor) {
      await withFileLock(filePath, async () => {
        const data = await readItemsFile(filePath);
        const item = data.items.find((existing) => existing.itemId === itemId);
        if (!item) {
          throw new Error(`Item not found: ${itemId}`);
        }
        item.cursor = cursor;
        await writeItemsFile(filePath, data);
      });
    },

    async remove(itemId) {
      await withFileLock(filePath, async () => {
        const data = await readItemsFile(filePath);
        data.items = data.items.filter((item) => item.itemId !== itemId);
        await writeItemsFile(filePath, data);
      });
    },
  };
}
