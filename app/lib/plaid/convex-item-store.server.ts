import { api } from "../../../convex/_generated/api";
import { getConvexClient } from "~/lib/convex.server";
import { env } from "~/lib/env.server";
import type { ItemStore, PlaidItem } from "~/lib/plaid/types";

export function createConvexItemStore(): ItemStore {
  const client = getConvexClient();
  const secret = env.CONVEX_INTERNAL_SECRET;

  return {
    async save(userId: string, item: PlaidItem): Promise<void> {
      await client.mutation(api.items.save, { userId, secret, item });
    },

    async list(userId: string): Promise<PlaidItem[]> {
      return client.query(api.items.list, { userId, secret });
    },

    async get(userId: string, itemId: string): Promise<PlaidItem | null> {
      return client.query(api.items.get, { userId, secret, itemId });
    },

    async setCursor(
      userId: string,
      itemId: string,
      cursor: string,
    ): Promise<void> {
      await client.mutation(api.items.setCursor, {
        userId,
        secret,
        itemId,
        cursor,
      });
    },

    async remove(userId: string, itemId: string): Promise<void> {
      await client.mutation(api.items.remove, { userId, secret, itemId });
    },
  };
}
