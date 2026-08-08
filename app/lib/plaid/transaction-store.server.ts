import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createKeyedLock } from "~/lib/plaid/async-lock.server";
import type {
  SyncDiff,
  Transaction,
  TransactionStore,
} from "~/lib/plaid/types";

const withFileLock = createKeyedLock<string>();

interface TransactionsFile {
  byUser: Record<string, Record<string, Record<string, Transaction>>>;
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
      return { byUser: {} };
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

function bucketForItem(
  data: TransactionsFile,
  userId: string,
  itemId: string,
): Record<string, Transaction> {
  return data.byUser[userId]?.[itemId] ?? {};
}

export function createFileTransactionStore(dataDir = ".data"): TransactionStore {
  const filePath = path.join(dataDir, "transactions.json");

  return {
    async applySync(userId, itemId, diff) {
      await withFileLock(filePath, async () => {
        const data = await readTransactionsFile(filePath);
        const userBuckets = data.byUser[userId] ?? {};
        userBuckets[itemId] = applySyncDiff(bucketForItem(data, userId, itemId), diff);
        data.byUser[userId] = userBuckets;
        await writeTransactionsFile(filePath, data);
      });
    },

    async list(userId, itemId, options) {
      return withFileLock(filePath, async () => {
        const data = await readTransactionsFile(filePath);
        const userBuckets = data.byUser[userId] ?? {};
        const buckets = itemId
          ? { [itemId]: bucketForItem(data, userId, itemId) }
          : userBuckets;

        let transactions = Object.values(buckets).flatMap((bucket) =>
          Object.values(bucket),
        );

        if (options?.startDate !== undefined && options?.endDate !== undefined) {
          transactions = transactions.filter(
            (transaction) =>
              transaction.date >= options.startDate! &&
              transaction.date <= options.endDate!,
          );
        }

        if (transactions.length === 0) {
          return [];
        }

        return transactions.sort((a, b) => b.date.localeCompare(a.date));
      });
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
