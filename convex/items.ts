import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireInternalSecret } from "./lib/auth";
import { resolveUserId } from "./lib/users";

const plaidItem = v.object({
  itemId: v.string(),
  accessToken: v.string(),
  institutionId: v.string(),
  institutionName: v.string(),
  cursor: v.union(v.string(), v.null()),
  createdAt: v.string(),
});

function toPlaidItem(item: Doc<"items">) {
  return {
    itemId: item.itemId,
    accessToken: item.accessToken,
    institutionId: item.institutionId,
    institutionName: item.institutionName,
    cursor: item.cursor,
    createdAt: item.createdAt,
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

export const save = mutation({
  args: {
    userId: v.string(),
    secret: v.string(),
    item: plaidItem,
  },
  handler: async (ctx, { userId, secret, item }) => {
    requireInternalSecret(secret);
    const convexUserId = await resolveUserId(ctx, userId);
    const existing = await ctx.db
      .query("items")
      .withIndex("by_itemId", (q) => q.eq("itemId", item.itemId))
      .unique();

    if (existing) {
      if (existing.userId !== convexUserId) {
        throw new Error(`Item not found: ${item.itemId}`);
      }

      await ctx.db.patch(existing._id, item);
      return;
    }

    await ctx.db.insert("items", {
      userId: convexUserId,
      ...item,
    });
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
    const items = await ctx.db
      .query("items")
      .withIndex("by_userId", (q) => q.eq("userId", convexUserId))
      .collect();

    return items.map(toPlaidItem);
  },
});

export const get = query({
  args: {
    userId: v.string(),
    secret: v.string(),
    itemId: v.string(),
  },
  handler: async (ctx, { userId, secret, itemId }) => {
    requireInternalSecret(secret);
    const item = await getOwnedItem(ctx, userId, itemId);
    return item ? toPlaidItem(item) : null;
  },
});

export const setCursor = mutation({
  args: {
    userId: v.string(),
    secret: v.string(),
    itemId: v.string(),
    cursor: v.string(),
  },
  handler: async (ctx, { userId, secret, itemId, cursor }) => {
    requireInternalSecret(secret);
    const item = await getOwnedItem(ctx, userId, itemId);
    if (!item) {
      throw new Error(`Item not found: ${itemId}`);
    }

    await ctx.db.patch(item._id, { cursor });
  },
});

export const remove = mutation({
  args: {
    userId: v.string(),
    secret: v.string(),
    itemId: v.string(),
  },
  handler: async (ctx, { userId, secret, itemId }) => {
    requireInternalSecret(secret);
    const item = await getOwnedItem(ctx, userId, itemId);
    if (item) {
      await ctx.db.delete(item._id);
    }
  },
});
