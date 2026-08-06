import { getAuth } from "@clerk/react-router/server";
import { data, redirect, type LoaderFunctionArgs } from "react-router";

export async function requirePageAuth(args: LoaderFunctionArgs) {
  const auth = await getAuth(args);
  if (!auth.isAuthenticated) {
    throw redirect(
      `/sign-in?redirect_url=${encodeURIComponent(args.request.url)}`,
    );
  }
  return { userId: auth.userId };
}

export async function requireApiAuth(args: LoaderFunctionArgs) {
  const auth = await getAuth(args);
  if (!auth.isAuthenticated) {
    throw data({ error: "Unauthorized" }, { status: 401 });
  }
  return { userId: auth.userId };
}
