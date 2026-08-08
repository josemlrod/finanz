import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export async function resolveUserId(
  ctx: QueryCtx | MutationCtx,
  clerkUserId: string,
): Promise<Id<"users">> {
  const user = await ctx.db
    .query("users")
    .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", clerkUserId))
    .unique();

  if (!user) {
    throw new Error(`User not found: ${clerkUserId}`);
  }

  return user._id;
}
