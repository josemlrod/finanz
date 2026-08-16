import { type Infer, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { requireInternalSecret } from "./lib/auth";
import { resolveUserId } from "./lib/users";

const personalFinanceCategory = v.union(
  v.object({
    primary: v.string(),
    detailed: v.string(),
    confidenceLevel: v.union(v.string(), v.null()),
  }),
  v.null(),
);

const transaction = v.object({
  transactionId: v.string(),
  itemId: v.string(),
  accountId: v.string(),
  amount: v.number(),
  date: v.string(),
  name: v.string(),
  merchantName: v.union(v.string(), v.null()),
  pending: v.boolean(),
  personalFinanceCategory,
  categoryIconUrl: v.union(v.string(), v.null()),
  logoUrl: v.union(v.string(), v.null()),
  website: v.union(v.string(), v.null()),
  isoCurrencyCode: v.union(v.string(), v.null()),
});

const syncDiff = v.object({
  added: v.array(transaction),
  modified: v.array(transaction),
  removed: v.array(v.string()),
});

function toTransaction(doc: Doc<"transactions">) {
  return {
    transactionId: doc.transactionId,
    itemId: doc.itemId,
    accountId: doc.accountId,
    amount: doc.amount,
    date: doc.date,
    name: doc.name,
    merchantName: doc.merchantName,
    pending: doc.pending,
    personalFinanceCategory: doc.personalFinanceCategory,
    userCategoryPrimary: doc.userCategoryPrimary ?? null,
    categoryIconUrl: doc.categoryIconUrl,
    logoUrl: doc.logoUrl,
    website: doc.website,
    isoCurrencyCode: doc.isoCurrencyCode,
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

async function upsertTransaction(
  ctx: MutationCtx,
  convexUserId: Awaited<ReturnType<typeof resolveUserId>>,
  itemId: string,
  tx: Infer<typeof transaction>,
) {
  const existing = await ctx.db
    .query("transactions")
    .withIndex("by_transactionId", (q) => q.eq("transactionId", tx.transactionId))
    .filter((q) => q.eq(q.field("userId"), convexUserId))
    .first();

  const fields = {
    itemId,
    accountId: tx.accountId,
    amount: tx.amount,
    date: tx.date,
    name: tx.name,
    merchantName: tx.merchantName,
    pending: tx.pending,
    personalFinanceCategory: tx.personalFinanceCategory,
    categoryIconUrl: tx.categoryIconUrl,
    logoUrl: tx.logoUrl,
    website: tx.website,
    isoCurrencyCode: tx.isoCurrencyCode,
  };

  if (existing) {
    await ctx.db.patch(existing._id, fields);
    return;
  }

  await ctx.db.insert("transactions", {
    userId: convexUserId,
    transactionId: tx.transactionId,
    ...fields,
  });
}

async function removeTransaction(
  ctx: MutationCtx,
  convexUserId: Awaited<ReturnType<typeof resolveUserId>>,
  transactionId: string,
) {
  const existing = await ctx.db
    .query("transactions")
    .withIndex("by_transactionId", (q) => q.eq("transactionId", transactionId))
    .filter((q) => q.eq(q.field("userId"), convexUserId))
    .first();

  if (existing) {
    await ctx.db.delete(existing._id);
  }
}

export const applySync = mutation({
  args: {
    userId: v.string(),
    secret: v.string(),
    itemId: v.string(),
    diff: syncDiff,
  },
  handler: async (ctx, { userId, secret, itemId, diff }) => {
    requireInternalSecret(secret);
    const item = await getOwnedItem(ctx, userId, itemId);
    if (!item) {
      throw new Error(`Item not found: ${itemId}`);
    }

    const convexUserId = item.userId;

    for (const tx of diff.added) {
      await upsertTransaction(ctx, convexUserId, itemId, tx);
    }

    for (const tx of diff.modified) {
      await upsertTransaction(ctx, convexUserId, itemId, tx);
    }

    for (const transactionId of diff.removed) {
      await removeTransaction(ctx, convexUserId, transactionId);
    }
  },
});

export const setCategoryOverride = mutation({
  args: {
    userId: v.string(),
    secret: v.string(),
    transactionId: v.string(),
    primary: v.union(v.string(), v.null()),
  },
  handler: async (ctx, { userId, secret, transactionId, primary }) => {
    requireInternalSecret(secret);
    const convexUserId = await resolveUserId(ctx, userId);
    const existing = await ctx.db
      .query("transactions")
      .withIndex("by_transactionId", (q) => q.eq("transactionId", transactionId))
      .filter((q) => q.eq(q.field("userId"), convexUserId))
      .first();

    if (!existing) {
      throw new Error(`Transaction not found: ${transactionId}`);
    }
    if (existing.pending) {
      throw new Error("Pending Transactions cannot be categorized");
    }

    await ctx.db.patch(existing._id, {
      userCategoryPrimary: primary ?? undefined,
    });
  },
});

export const list = query({
  args: {
    userId: v.string(),
    secret: v.string(),
    itemId: v.optional(v.string()),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
  },
  handler: async (ctx, { userId, secret, itemId, startDate, endDate }) => {
    requireInternalSecret(secret);
    const convexUserId = await resolveUserId(ctx, userId);

    let transactions;
    if (startDate !== undefined && endDate !== undefined) {
      transactions = await ctx.db
        .query("transactions")
        .withIndex("by_userId_date", (q) =>
          q.eq("userId", convexUserId).gte("date", startDate).lte("date", endDate),
        )
        .collect();
    } else {
      transactions = await ctx.db
        .query("transactions")
        .withIndex("by_userId_date", (q) => q.eq("userId", convexUserId))
        .collect();
    }

    const filtered = itemId
      ? transactions.filter((tx) => tx.itemId === itemId)
      : transactions;

    return filtered
      .map(toTransaction)
      .sort((a, b) => b.date.localeCompare(a.date));
  },
});
