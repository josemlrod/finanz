import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const personalFinanceCategory = v.union(
  v.object({
    primary: v.string(),
    detailed: v.string(),
    confidenceLevel: v.union(v.string(), v.null()),
  }),
  v.null(),
);

export default defineSchema({
  users: defineTable({
    clerkUserId: v.string(),
  }).index("by_clerkUserId", ["clerkUserId"]),

  items: defineTable({
    userId: v.id("users"),
    itemId: v.string(),
    accessToken: v.string(),
    institutionId: v.string(),
    institutionName: v.string(),
    cursor: v.union(v.string(), v.null()),
    createdAt: v.string(),
  })
    .index("by_userId", ["userId"])
    .index("by_itemId", ["itemId"]),

  transactions: defineTable({
    userId: v.id("users"),
    itemId: v.string(),
    transactionId: v.string(),
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
  })
    .index("by_userId_date", ["userId", "date"])
    .index("by_itemId", ["itemId"])
    .index("by_itemId_transactionId", ["itemId", "transactionId"]),

  accounts: defineTable({
    userId: v.id("users"),
    itemId: v.string(),
    accountId: v.string(),
    name: v.string(),
    officialName: v.union(v.string(), v.null()),
    type: v.string(),
    subtype: v.union(v.string(), v.null()),
    mask: v.union(v.string(), v.null()),
    currentBalance: v.union(v.number(), v.null()),
    availableBalance: v.union(v.number(), v.null()),
    isoCurrencyCode: v.union(v.string(), v.null()),
    updatedAt: v.string(),
  })
    .index("by_userId", ["userId"])
    .index("by_itemId", ["itemId"]),
});
