import { createHash, randomBytes } from 'node:crypto';
import { clerkClient } from '@clerk/react-router/server';
import { ConvexError } from 'convex/values';
import type { LoaderFunctionArgs } from 'react-router';
import { api } from '../../../convex/_generated/api';
import type { Id, TableNames } from '../../../convex/_generated/dataModel';
import { validateGoalConfig, type GoalConfig } from '../../../convex/lib/goals';
import { getConvexClient } from '~/lib/convex.server';
import { env } from '~/lib/env.server';

export const savingsHeaders = {
	'Cache-Control': 'no-store',
	'Referrer-Policy': 'no-referrer',
};

export function goalError(error: unknown) {
	const statuses: Record<string, number> = {
		INVALID_INPUT: 400,
		FORBIDDEN: 403,
		CONFLICT: 409,
		GRID_CHANGED: 409,
		ARCHIVED: 409,
		LOCKED: 409,
		INVITE_UNAVAILABLE: 410,
		INVITE_LIMIT: 409,
	};
	if (
		error instanceof ConvexError &&
		error.data &&
		typeof error.data === 'object'
	) {
		const { code, message } = error.data;
		if (
			typeof code === 'string' &&
			Object.hasOwn(statuses, code) &&
			typeof message === 'string'
		) {
			return { code, message, status: statuses[code] };
		}
	}
	// Never send database errors, request URLs, or invite tokens back as diagnostics.
	return {
		code: 'UNAVAILABLE',
		message: 'Savings are temporarily unavailable. Please try again.',
		status: 503,
	};
}

function invalid(message: string): never {
	throw new ConvexError({ code: 'INVALID_INPUT', message });
}

export function readGoalConfig(form: FormData): GoalConfig {
	function text(key: string) {
		const values = form.getAll(key);
		const value = values[0];
		if (values.length !== 1 || typeof value !== 'string')
			return invalid(`Supply exactly one ${key}.`);
		return value;
	}
	function cents(key: string) {
		const value = text(key);
		if (!/^[0-9]+$/.test(value))
			return invalid('Amounts must be positive whole dollars.');
		return Number(value);
	}
	return validateGoalConfig({
		name: text('name'),
		targetCents: cents('targetCents'),
		minCellCents: cents('minCellCents'),
		maxCellCents: cents('maxCellCents'),
		startDate: text('startDate'),
		targetDate: text('targetDate'),
	});
}

export async function getGoalDisplayName(
	userId: string,
	args: LoaderFunctionArgs,
) {
	const profile = await clerkClient(args).users.getUser(userId);
	const name = [profile.firstName, profile.lastName]
		.filter(Boolean)
		.join(' ')
		.trim();
	const primaryEmail =
		profile.emailAddresses.find(
			(email) => email.id === profile.primaryEmailAddressId,
		)?.emailAddress ?? '';
	return (name || profile.username || primaryEmail || 'Goal member').slice(
		0,
		80,
	);
}

function id<Table extends TableNames>(value: string): Id<Table> {
	if (!/^[a-zA-Z0-9_-]{1,128}$/.test(value)) invalid('Invalid identifier.');
	return value as Id<Table>;
}

function tokenHash(token: string) {
	if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
		throw new ConvexError({
			code: 'INVITE_UNAVAILABLE',
			message: 'This invitation is no longer available.',
		});
	}
	return createHash('sha256').update(token).digest('hex');
}

export function goalStore(userId: string) {
	const client = getConvexClient();
	const auth = { userId, internalSecret: env.CONVEX_INTERNAL_SECRET };
	const goal = (goalId: string) => ({ ...auth, goalId: id<'goals'>(goalId) });
	return {
		list: ({
			cursor,
			archived = false,
		}: {
			cursor?: string;
			archived?: boolean;
		} = {}) =>
			client.query(api.goals.list, {
				...auth,
				archived,
				...(cursor !== undefined ? { cursor } : {}),
			}),
		detail: (goalId: string) => client.query(api.goals.detail, goal(goalId)),
		activity: (goalId: string, cursor?: string) =>
			client.query(api.goals.activity, {
				...goal(goalId),
				...(cursor ? { cursor } : {}),
			}),
		create: (config: GoalConfig, displayName: string) =>
			client.mutation(api.goals.create, { ...auth, config, displayName }),
		record: (
			goalId: string,
			input: {
				cellIndexes: number[];
				expectedGridRevision: number;
				submissionId: string;
			},
		) => client.mutation(api.goals.record, { ...goal(goalId), ...input }),
		undo: (goalId: string, contributionId: string) =>
			client.mutation(api.goals.undo, {
				...goal(goalId),
				contributionId: id<'goalContributions'>(contributionId),
			}),
		edit: (goalId: string, config: GoalConfig, expectedGridRevision: number) =>
			client.mutation(api.goals.edit, {
				...goal(goalId),
				config,
				expectedGridRevision,
			}),
		createInvite: async (goalId: string) => {
			const token = randomBytes(32).toString('base64url');
			const inviteId = await client.mutation(api.goals.createInvite, {
				...goal(goalId),
				tokenHash: tokenHash(token),
			});
			return { token, inviteId };
		},
		inspectInvite: (token: string) =>
			client.query(api.goals.inspectInvite, {
				...auth,
				tokenHash: tokenHash(token),
			}),
		acceptInvite: (token: string, displayName: string) =>
			client.mutation(api.goals.acceptInvite, {
				...auth,
				tokenHash: tokenHash(token),
				displayName,
			}),
		removeMember: (goalId: string, memberUserId: string) =>
			client.mutation(api.goals.removeMember, {
				...goal(goalId),
				memberUserId: id<'users'>(memberUserId),
			}),
		revokeInvite: (goalId: string, inviteId: string) =>
			client.mutation(api.goals.revokeInvite, {
				...goal(goalId),
				inviteId: id<'goalInvites'>(inviteId),
			}),
		setArchived: (goalId: string, archived: boolean) =>
			client.mutation(api.goals.setArchived, { ...goal(goalId), archived }),
	};
}
