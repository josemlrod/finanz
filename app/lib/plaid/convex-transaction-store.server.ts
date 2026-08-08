import { api } from "../../../convex/_generated/api";
import { getConvexClient } from "~/lib/convex.server";
import { env } from "~/lib/env.server";
import type {
  SyncDiff,
  Transaction,
  TransactionListOptions,
  TransactionStore,
} from "~/lib/plaid/types";

export function createConvexTransactionStore(): TransactionStore {
  const client = getConvexClient();
  const secret = env.CONVEX_INTERNAL_SECRET;

  return {
    async applySync(
      userId: string,
      itemId: string,
      diff: SyncDiff,
    ): Promise<void> {
      await client.mutation(api.transactions.applySync, {
        userId,
        secret,
        itemId,
        diff,
      });
    },

    async list(
      userId: string,
      itemId?: string,
      options?: TransactionListOptions,
    ): Promise<Transaction[]> {
      return client.query(api.transactions.list, {
        userId,
        secret,
        itemId,
        startDate: options?.startDate,
        endDate: options?.endDate,
      });
    },
  };
}
