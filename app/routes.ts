import {
	type RouteConfig,
	index,
	prefix,
	route,
} from '@react-router/dev/routes';

export default [
	index('routes/home.tsx'),
	route('sign-in', 'routes/sign-in.tsx'),
	route('sign-up', 'routes/sign-up.tsx'),
	route('goals', 'routes/goals.tsx'),
	route('goals/:goalId', 'routes/goal-detail.tsx'),
	route('invites/:token', 'routes/goal-invite.tsx'),
	...prefix('api/plaid', [
		route('link-token', 'routes/api/plaid/link-token.ts'),
		route('exchange', 'routes/api/plaid/exchange.ts'),
		route('sync', 'routes/api/plaid/sync.ts'),
		route('refresh-balances', 'routes/api/plaid/refresh-balances.ts'),
	]),
	route('api/transactions/category', 'routes/api/transactions/category.ts'),
	route('*', 'routes/not-found.tsx'),
] satisfies RouteConfig;
