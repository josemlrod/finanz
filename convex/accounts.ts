import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireInternalSecret } from "./lib/auth";
import { resolveUserId } from "./lib/users";

const linkedAccount = v.object({
  accountId: v.string(),
  itemId: v.string(),
  name: v.string(),
  officialName: v.union(v.string(), v.null()),
  type: v.string(),
  subtype: v.union(v.string(), v.null()),
  mask: v.union(v.string(), v.null()),
  currentBalance: v.union(v.number(), v.null()),
  availableBalance: v.union(v.number(), v.null()),
  isoCurrencyCode: v.union(v.string(), v.null()),
});

function toLinkedAccount(doc: Doc<"accounts">) {
  return {
    accountId: doc.accountId,
    itemId: doc.itemId,
    name: doc.name,
    officialName: doc.officialName,
    type: doc.type,
    subtype: doc.subtype,
    mask: doc.mask,
    currentBalance: doc.currentBalance,
    availableBalance: doc.availableBalance,
    isoCurrencyCode: doc.isoCurrencyCode,
    updatedAt: doc.updatedAt,
  };
}

async function getOwnedItem(
  ctx: Parameters<typeof resolveUserId>[0],
  clerkUserId: string,
  itemId: string,
) {
  const userId = await resolveUserId(ctx, clerkUserId);
  const item = await ctx.db
    .query("items")
    .withIndex("by_itemId", (q) => q.eq("itemId", itemId))
    .unique();

  if (!item || item.userId !== userId) {
    return null;
  }

  return item;
}

export const replaceForItem = mutation({
  args: {
    userId: v.string(),
    itemId: v.string(),
    accounts: v.array(linkedAccount),
    secret: v.string(),
  },
  handler: async (ctx, { userId, secret, itemId, accounts }) => {
    requireInternalSecret(secret);
    const item = await getOwnedItem(ctx, userId, itemId);
    if (!item) {
      throw new Error(`Item not found: ${itemId}`);
    }

    const existing = await ctx.db
      .query("accounts")
      .withIndex("by_itemId", (q) => q.eq("itemId", itemId))
      .collect();

    for (const account of existing) {
      if (account.userId === item.userId) {
        await ctx.db.delete(account._id);
      }
    }

    const updatedAt = new Date().toISOString();
    for (const account of accounts) {
      await ctx.db.insert("accounts", {
        userId: item.userId,
        itemId,
        accountId: account.accountId,
        name: account.name,
        officialName: account.officialName,
        type: account.type,
        subtype: account.subtype,
        mask: account.mask,
        currentBalance: account.currentBalance,
        availableBalance: account.availableBalance,
        isoCurrencyCode: account.isoCurrencyCode,
        updatedAt,
      });
    }
  },
});

export const list = query({
  args: {
    userId: v.string(),
    secret: v.string(),
  },
  handler: async (ctx, { userId, secret }) => {
    requireInternalSecret(secret);
    const convexUserId = await resolveUserId(ctx, userId);
    const accounts = await ctx.db
      .query("accounts")
      .withIndex("by_userId", (q) => q.eq("userId", convexUserId))
      .collect();

    return accounts.map(toLinkedAccount);
  },
});
