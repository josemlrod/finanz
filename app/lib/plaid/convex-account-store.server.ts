import { api } from "../../../convex/_generated/api";
import { getConvexClient } from "~/lib/convex.server";
import { env } from "~/lib/env.server";
import type { AccountStore, LinkedAccount } from "~/lib/plaid/types";

export function createConvexAccountStore(): AccountStore {
  const client = getConvexClient();
  const secret = env.CONVEX_INTERNAL_SECRET;

  return {
    async replaceForItem(
      userId: string,
      itemId: string,
      accounts: LinkedAccount[],
    ): Promise<void> {
      await client.mutation(api.accounts.replaceForItem, {
        userId,
        secret,
        itemId,
        accounts,
      });
    },

    async list(userId: string): Promise<LinkedAccount[]> {
      return client.query(api.accounts.list, { userId, secret });
    },
  };
}
