import type { SyncDiff, Transaction } from "~/lib/plaid/types";

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
