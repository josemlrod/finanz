import { getAuth } from '@clerk/react-router/server';
import { data, redirect, type LoaderFunctionArgs } from 'react-router';
import { upsertUser } from '~/lib/convex.server';
import { authResponseHeaders, safeReturnTo } from '~/lib/auth-redirect';

async function ensureConvexUser(clerkUserId: string) {
	await upsertUser(clerkUserId);
}

export async function requirePageAuth(args: LoaderFunctionArgs) {
	const auth = await getAuth(args);
	if (!auth.isAuthenticated) {
		const url = new URL(args.request.url);
		const search = new URLSearchParams({
			returnTo: safeReturnTo(url.pathname + url.search),
		});
		throw redirect(`/sign-in?${search}`, { headers: authResponseHeaders });
	}
	await ensureConvexUser(auth.userId);
	return { userId: auth.userId };
}

export async function requireApiAuth(args: LoaderFunctionArgs) {
	const auth = await getAuth(args);
	if (!auth.isAuthenticated) {
		throw data({ error: 'Unauthorized' }, { status: 401 });
	}
	await ensureConvexUser(auth.userId);
	return { userId: auth.userId };
}
