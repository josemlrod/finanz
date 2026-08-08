import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { env } from "~/lib/env.server";

let client: ConvexHttpClient | undefined;

export function getConvexClient(): ConvexHttpClient {
  if (!client) {
    client = new ConvexHttpClient(env.CONVEX_URL);
  }
  return client;
}

export async function upsertUser(clerkUserId: string): Promise<void> {
  await getConvexClient().mutation(api.users.upsert, {
    userId: clerkUserId,
    secret: env.CONVEX_INTERNAL_SECRET,
  });
}
