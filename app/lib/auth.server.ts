import { getAuth } from "@clerk/react-router/server";
import { data, redirect, type LoaderFunctionArgs } from "react-router";
import { upsertUser } from "~/lib/convex.server";

async function ensureConvexUser(clerkUserId: string) {
  await upsertUser(clerkUserId);
}

export async function requirePageAuth(args: LoaderFunctionArgs) {
  const auth = await getAuth(args);
  if (!auth.isAuthenticated) {
    throw redirect('/sign-in');
  }
  await ensureConvexUser(auth.userId);
  return { userId: auth.userId };
}

export async function requireApiAuth(args: LoaderFunctionArgs) {
  const auth = await getAuth(args);
  if (!auth.isAuthenticated) {
    throw data({ error: "Unauthorized" }, { status: 401 });
  }
  await ensureConvexUser(auth.userId);
  return { userId: auth.userId };
}
