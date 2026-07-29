import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  SyncDiff,
  Transaction,
  TransactionStore,
} from "~/lib/plaid/types";

interface TransactionsFile {
  byItem: Record<string, Record<string, Transaction>>;
}

async function readTransactionsFile(
  filePath: string,
): Promise<TransactionsFile> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as TransactionsFile;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return { byItem: {} };
    }
    throw error;
  }
}

async function writeTransactionsFile(
  filePath: string,
  data: TransactionsFile,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(data, null, 2), "utf8");
  await rename(tmpPath, filePath);
}

export function createFileTransactionStore(dataDir = ".data"): TransactionStore {
  const filePath = path.join(dataDir, "transactions.json");

  return {
    async applySync(itemId, diff) {
      const data = await readTransactionsFile(filePath);
      data.byItem[itemId] = applySyncDiff(data.byItem[itemId] ?? {}, diff);
      await writeTransactionsFile(filePath, data);
    },

    async list(itemId) {
      const data = await readTransactionsFile(filePath);
      const bucket = data.byItem[itemId];
      if (!bucket) {
        return [];
      }

      return Object.values(bucket).sort((a, b) => b.date.localeCompare(a.date));
    },
  };
}

/** Applies a sync diff to a transaction bucket and returns the updated bucket. */
export function applySyncDiff(
  bucket: Record<string, Transaction>,
  diff: SyncDiff,
): Record<string, Transaction> {
  const next = { ...bucket };

  for (const transaction of diff.added) {
    next[transaction.transactionId] = transaction;
  }

  for (const transaction of diff.modified) {
    next[transaction.transactionId] = transaction;
  }

  for (const transactionId of diff.removed) {
    delete next[transactionId];
  }

  return next;
}
