import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireInternalSecret } from "./lib/auth";

export const upsert = mutation({
  args: {
    userId: v.string(),
    secret: v.string(),
  },
  handler: async (ctx, { userId, secret }) => {
    requireInternalSecret(secret);

    const existing = await ctx.db
      .query("users")
      .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", userId))
      .unique();

    if (existing) {
      return existing._id;
    }

    return await ctx.db.insert("users", { clerkUserId: userId });
  },
});
