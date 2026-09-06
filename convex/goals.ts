import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { mutation, query, type QueryCtx } from './_generated/server';
import { requireInternalSecret } from './lib/auth';
import { generateGrid, validateGoalConfig, type GoalConfig } from './lib/goals';
import { resolveUserId } from './lib/users';

const authArgs = { internalSecret: v.string(), userId: v.string() };
const goalArgs = { ...authArgs, goalId: v.id('goals') };
const configArg = v.object({
	name: v.string(),
	targetCents: v.number(),
	minCellCents: v.number(),
	maxCellCents: v.number(),
	startDate: v.string(),
	targetDate: v.string(),
});

function fail(code: string, message: string): never {
	throw new ConvexError({ code, message });
}

async function actor(
	ctx: QueryCtx,
	args: { internalSecret: string; userId: string },
) {
	try {
		requireInternalSecret(args.internalSecret);
		return await resolveUserId(ctx, args.userId);
	} catch {
		return fail('FORBIDDEN', 'Authentication required.');
	}
}

async function authenticatedActor(ctx: QueryCtx) {
	try {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return fail('FORBIDDEN', 'Authentication required.');
		return await resolveUserId(ctx, identity.subject);
	} catch (error) {
		if (error instanceof ConvexError) throw error;
		return fail('FORBIDDEN', 'Authentication required.');
	}
}

function member(ctx: QueryCtx, goalId: Id<'goals'>, userId: Id<'users'>) {
	return ctx.db
		.query('goalMembers')
		.withIndex('by_goalId_userId', (q) =>
			q.eq('goalId', goalId).eq('userId', userId),
		)
		.unique();
}

async function accessibleGoal(
	ctx: QueryCtx,
	goalId: Id<'goals'>,
	userId: Id<'users'>,
) {
	const goal = await ctx.db.get(goalId);
	if (!goal) return null;
	if (goal.ownerId === userId) return goal;
	const membership = await member(ctx, goalId, userId);
	return membership && membership.removedAt === null ? goal : null;
}

async function authorize(
	ctx: QueryCtx,
	goalId: Id<'goals'>,
	userId: Id<'users'>,
	ownerOnly = false,
) {
	const goal = await accessibleGoal(ctx, goalId, userId);
	if (!goal || (ownerOnly && goal.ownerId !== userId)) {
		return fail('FORBIDDEN', 'You do not have access to this goal.');
	}
	return goal;
}

function requireActive(goal: Doc<'goals'>) {
	if (goal.archivedAt !== null) fail('ARCHIVED', 'Unarchive this goal first.');
}

function config(input: GoalConfig) {
	try {
		return validateGoalConfig(input);
	} catch (error) {
		if (error instanceof ConvexError) throw error;
		return fail(
			'INVALID_INPUT',
			error instanceof Error ? error.message : 'Invalid goal configuration.',
		);
	}
}

function safeName(name: string) {
	const normalized = name
		.replace(/[\u0000-\u001f\u007f]/g, ' ')
		.trim()
		.replace(/\s+/g, ' ');
	return normalized ? normalized.slice(0, 80) : 'Goal member';
}

function activeContributions(ctx: QueryCtx, goalId: Id<'goals'>) {
	return ctx.db
		.query('goalContributions')
		.withIndex('by_goalId_undoneAt', (q) =>
			q.eq('goalId', goalId).eq('undoneAt', null),
		)
		.take(500);
}

function submission(
	ctx: QueryCtx,
	goalId: Id<'goals'>,
	contributorId: Id<'users'>,
	submissionId: string,
) {
	return ctx.db
		.query('goalContributions')
		.withIndex('by_goalId_contributorId_submissionId', (q) =>
			q
				.eq('goalId', goalId)
				.eq('contributorId', contributorId)
				.eq('submissionId', submissionId),
		)
		.take(500);
}

function liveInvites(ctx: QueryCtx, goalId: Id<'goals'>, now: string) {
	// Expired rows never consume the 20-invite capacity or require historical scans.
	return ctx.db
		.query('goalInvites')
		.withIndex('by_goalId_revokedAt_redeemedAt_expiresAt', (q) =>
			q
				.eq('goalId', goalId)
				.eq('revokedAt', null)
				.eq('redeemedAt', null)
				.gt('expiresAt', now),
		)
		.take(20);
}

async function availableInvite(ctx: QueryCtx, tokenHash: string) {
	const invite = await ctx.db
		.query('goalInvites')
		.withIndex('by_tokenHash', (q) => q.eq('tokenHash', tokenHash))
		.unique();
	if (
		!invite ||
		invite.revokedAt !== null ||
		invite.redeemedAt !== null ||
		invite.expiresAt <= new Date().toISOString()
	)
		return null;
	const goal = await ctx.db.get(invite.goalId);
	return goal && goal.archivedAt === null ? { invite, goal } : null;
}

async function goalDetail(
	ctx: QueryCtx,
	goalId: Id<'goals'>,
	userId: Id<'users'>,
) {
	const goal = await accessibleGoal(ctx, goalId, userId);
	if (!goal) return null;
	const contributions = await activeContributions(ctx, goal._id);
	// Keep former members in creation order so attribution and palette assignment survive removal.
	const memberships = await ctx.db
		.query('goalMembers')
		.withIndex('by_goalId', (q) => q.eq('goalId', goal._id))
		.collect();
	const isOwner = goal.ownerId === userId;
	const invites = isOwner
		? await liveInvites(ctx, goal._id, new Date().toISOString())
		: [];
	return {
		goal,
		viewer: { userId, isOwner },
		members: memberships.map((membership) => {
			const own = contributions.filter(
				(row) => row.contributorId === membership.userId,
			);
			return {
				...membership,
				recordedCents: own.reduce((sum, row) => sum + row.amountCents, 0),
				cellCount: own.length,
			};
		}),
		contributions,
		invites: invites.map(({ tokenHash: _tokenHash, ...metadata }) => metadata),
	};
}

async function goalActivity(
	ctx: QueryCtx,
	goalId: Id<'goals'>,
	cursor?: string,
) {
	const result = await ctx.db
		.query('goalActivity')
		.withIndex('by_goalId_at', (q) => q.eq('goalId', goalId))
		.order('desc')
		.paginate({ cursor: cursor ?? null, numItems: 20 });
	const page = await Promise.all(
		result.page.map(async (event) => {
			if (event.kind === 'recorded') {
				return {
					...event,
					contributions: await submission(
						ctx,
						goalId,
						event.actorId,
						event.submissionId,
					),
				};
			}
			const contribution = await ctx.db.get(event.contributionId);
			return {
				...event,
				contributions:
					contribution && contribution.goalId === goalId ? [contribution] : [],
			};
		}),
	);
	return { page, continueCursor: result.continueCursor, isDone: result.isDone };
}

export const list = query({
	args: {
		...authArgs,
		cursor: v.optional(v.string()),
		archived: v.optional(v.boolean()),
	},
	handler: async (ctx, args) => {
		const userId = await actor(ctx, args);
		const memberships = await ctx.db
			.query('goalMembers')
			.withIndex('by_userId_removedAt', (q) =>
				q.eq('userId', userId).eq('removedAt', null),
			)
			.paginate({ cursor: args.cursor ?? null, numItems: 12 });
		const goals = await Promise.all(
			memberships.page.map(async (membership) => {
				const goal = await ctx.db.get(membership.goalId);
				if (!goal || (goal.archivedAt !== null) !== (args.archived ?? false))
					return null;
				const contributions = await activeContributions(ctx, goal._id);
				return {
					...goal,
					recordedCents: contributions.reduce(
						(sum, row) => sum + row.amountCents,
						0,
					),
					isOwner: goal.ownerId === userId,
				};
			}),
		);
		return {
			page: goals.filter((goal) => goal !== null),
			continueCursor: memberships.continueCursor,
			isDone: memberships.isDone,
		};
	},
});

export const detail = query({
	args: goalArgs,
	handler: async (ctx, args) => {
		const userId = await actor(ctx, args);
		return goalDetail(ctx, args.goalId, userId);
	},
});

export const detailForCurrentUser = query({
	args: { goalId: v.id('goals') },
	handler: async (ctx, args) => {
		console.log('called detailForCurrentUser');
		const userId = await authenticatedActor(ctx);
		console.log('userId', userId);
		return goalDetail(ctx, args.goalId, userId);
	},
});

export const activity = query({
	args: { ...goalArgs, cursor: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const userId = await actor(ctx, args);
		await authorize(ctx, args.goalId, userId);
		return goalActivity(ctx, args.goalId, args.cursor);
	},
});

export const activityForCurrentUser = query({
	args: { goalId: v.id('goals') },
	handler: async (ctx, args) => {
		const userId = await authenticatedActor(ctx);
		const goal = await accessibleGoal(ctx, args.goalId, userId);
		if (!goal) return null;
		return goalActivity(ctx, args.goalId);
	},
});

export const create = mutation({
	args: { ...authArgs, displayName: v.string(), config: configArg },
	handler: async (ctx, args) => {
		const userId = await actor(ctx, args);
		const validated = config(args.config);
		const goalId = await ctx.db.insert('goals', {
			...validated,
			ownerId: userId,
			currency: 'USD',
			method: 'amount_grid',
			cellAmountsCents: generateGrid(
				validated.targetCents,
				validated.minCellCents,
				validated.maxCellCents,
			),
			gridRevision: 1,
			firstContributionAt: null,
			archivedAt: null,
		});
		await ctx.db.insert('goalMembers', {
			goalId,
			userId,
			displayName: safeName(args.displayName),
			colorIndex: 0,
			joinedAt: new Date().toISOString(),
			removedAt: null,
		});
		return goalId;
	},
});

export const record = mutation({
	args: {
		...goalArgs,
		cellIndexes: v.array(v.number()),
		expectedGridRevision: v.number(),
		submissionId: v.string(),
	},
	handler: async (ctx, args) => {
		const userId = await actor(ctx, args);
		const goal = await authorize(ctx, args.goalId, userId);
		if (
			!args.submissionId.trim() ||
			args.submissionId.length > 128 ||
			args.cellIndexes.length === 0 ||
			args.cellIndexes.length > 500 ||
			new Set(args.cellIndexes).size !== args.cellIndexes.length ||
			args.cellIndexes.some(
				(index) => !Number.isSafeInteger(index) || index < 0,
			)
		) {
			fail(
				'INVALID_INPUT',
				'Supply distinct cell indexes and a submission ID of 1-128 characters.',
			);
		}
		const indexes = [...args.cellIndexes].sort((a, b) => a - b);
		const previous = (
			await submission(ctx, goal._id, userId, args.submissionId)
		).sort((a, b) => a.cellIndex - b.cellIndex);
		if (previous.length) {
			if (
				previous.length !== indexes.length ||
				previous.some(
					(row, index) =>
						row.cellIndex !== indexes[index] ||
						row.gridRevision !== args.expectedGridRevision,
				)
			) {
				fail(
					'CONFLICT',
					'This submission ID was already used for different cells or a different grid.',
				);
			}
			return {
				success: true as const,
				contributionIds: previous.map((row) => row._id),
				recordedCents: previous.reduce((sum, row) => sum + row.amountCents, 0),
			};
		}
		requireActive(goal);
		if (args.expectedGridRevision !== goal.gridRevision)
			fail(
				'GRID_CHANGED',
				'The grid changed. Review the new grid before recording savings.',
			);
		if (indexes.some((index) => index >= goal.cellAmountsCents.length))
			fail('INVALID_INPUT', 'Cell index is outside this grid.');
		for (const index of indexes) {
			const existing = await ctx.db
				.query('goalContributions')
				.withIndex('by_goalId_cellIndex_undoneAt', (q) =>
					q.eq('goalId', goal._id).eq('cellIndex', index).eq('undoneAt', null),
				)
				.unique();
			if (existing)
				fail(
					'CONFLICT',
					'A selected cell has already been completed. Review your selection.',
				);
		}
		const now = new Date().toISOString();
		const contributionIds: Id<'goalContributions'>[] = [];
		for (const cellIndex of indexes) {
			contributionIds.push(
				await ctx.db.insert('goalContributions', {
					goalId: goal._id,
					gridRevision: goal.gridRevision,
					cellIndex,
					contributorId: userId,
					amountCents: goal.cellAmountsCents[cellIndex],
					submissionId: args.submissionId,
					recordedAt: now,
					undoneAt: null,
					undoneBy: null,
				}),
			);
		}
		// This marker is permanent, including after every Contribution has been undone.
		if (goal.firstContributionAt === null)
			await ctx.db.patch(goal._id, { firstContributionAt: now });
		await ctx.db.insert('goalActivity', {
			goalId: goal._id,
			kind: 'recorded',
			actorId: userId,
			at: now,
			submissionId: args.submissionId,
		});
		return {
			success: true as const,
			contributionIds,
			recordedCents: indexes.reduce(
				(sum, index) => sum + goal.cellAmountsCents[index],
				0,
			),
		};
	},
});

export const undo = mutation({
	args: { ...goalArgs, contributionId: v.id('goalContributions') },
	handler: async (ctx, args) => {
		const userId = await actor(ctx, args);
		const goal = await authorize(ctx, args.goalId, userId);
		requireActive(goal);
		const contribution = await ctx.db.get(args.contributionId);
		if (
			!contribution ||
			contribution.goalId !== goal._id ||
			(goal.ownerId !== userId && contribution.contributorId !== userId)
		) {
			fail('FORBIDDEN', 'You cannot undo this Contribution.');
		}
		if (contribution.undoneAt !== null) return { success: true as const };
		const now = new Date().toISOString();
		await ctx.db.patch(contribution._id, { undoneAt: now, undoneBy: userId });
		await ctx.db.insert('goalActivity', {
			goalId: goal._id,
			kind: 'undone',
			actorId: userId,
			at: now,
			contributionId: contribution._id,
		});
		return { success: true as const };
	},
});

export const edit = mutation({
	args: { ...goalArgs, config: configArg, expectedGridRevision: v.number() },
	handler: async (ctx, args) => {
		const userId = await actor(ctx, args);
		const goal = await authorize(ctx, args.goalId, userId, true);
		requireActive(goal);
		if (args.expectedGridRevision !== goal.gridRevision)
			fail('GRID_CHANGED', 'The grid changed. Review the current settings.');
		const validated = config(args.config);
		const gridChanged =
			validated.targetCents !== goal.targetCents ||
			validated.minCellCents !== goal.minCellCents ||
			validated.maxCellCents !== goal.maxCellCents;
		if (
			goal.firstContributionAt !== null &&
			(gridChanged || validated.startDate !== goal.startDate)
		) {
			fail(
				'LOCKED',
				'Target, cell bounds, and start date stay locked after the first Contribution.',
			);
		}
		await ctx.db.patch(goal._id, {
			...validated,
			...(gridChanged
				? {
						cellAmountsCents: generateGrid(
							validated.targetCents,
							validated.minCellCents,
							validated.maxCellCents,
						),
						gridRevision: goal.gridRevision + 1,
					}
				: {}),
		});
		return { success: true as const };
	},
});

export const createInvite = mutation({
	args: { ...goalArgs, tokenHash: v.string() },
	handler: async (ctx, args) => {
		const userId = await actor(ctx, args);
		const goal = await authorize(ctx, args.goalId, userId, true);
		requireActive(goal);
		if (!args.tokenHash.trim() || args.tokenHash.length > 256)
			fail('INVALID_INPUT', 'Invalid invite token hash.');
		const existing = await ctx.db
			.query('goalInvites')
			.withIndex('by_tokenHash', (q) => q.eq('tokenHash', args.tokenHash))
			.unique();
		if (existing) fail('CONFLICT', 'This invite token has already been used.');
		const now = new Date().toISOString();
		if ((await liveInvites(ctx, goal._id, now)).length >= 20)
			fail(
				'INVITE_LIMIT',
				'Revoke an outstanding invite before creating another. The limit is 20.',
			);
		return ctx.db.insert('goalInvites', {
			goalId: goal._id,
			tokenHash: args.tokenHash,
			creatorId: userId,
			createdAt: now,
			expiresAt: new Date(
				Date.parse(now) + 7 * 24 * 60 * 60 * 1000,
			).toISOString(),
			recipientId: null,
			redeemedAt: null,
			revokedAt: null,
		});
	},
});

export const inspectInvite = query({
	args: { ...authArgs, tokenHash: v.string() },
	handler: async (ctx, args) => {
		const userId = await actor(ctx, args);
		const available = await availableInvite(ctx, args.tokenHash);
		if (!available) return null;
		const membership = await member(ctx, available.goal._id, userId);
		return {
			goalName: available.goal.name,
			eligible:
				available.goal.ownerId !== userId &&
				(!membership || membership.removedAt !== null),
		};
	},
});

export const acceptInvite = mutation({
	args: { ...authArgs, tokenHash: v.string(), displayName: v.string() },
	handler: async (ctx, args) => {
		const userId = await actor(ctx, args);
		const available = await availableInvite(ctx, args.tokenHash);
		if (!available)
			return fail(
				'INVITE_UNAVAILABLE',
				'This invitation is no longer available.',
			);
		const { goal, invite } = available;
		const membership = await member(ctx, goal._id, userId);
		if (
			goal.ownerId === userId ||
			(membership && membership.removedAt === null)
		)
			fail('INVITE_UNAVAILABLE', 'You already have access to this goal.');
		const now = new Date().toISOString();
		if (membership) {
			await ctx.db.patch(membership._id, {
				displayName: safeName(args.displayName),
				removedAt: null,
			});
		} else {
			const lastMember = await ctx.db
				.query('goalMembers')
				.withIndex('by_goalId', (q) => q.eq('goalId', goal._id))
				.order('desc')
				.first();
			await ctx.db.insert('goalMembers', {
				goalId: goal._id,
				userId,
				displayName: safeName(args.displayName),
				colorIndex: (lastMember?.colorIndex ?? -1) + 1,
				joinedAt: now,
				removedAt: null,
			});
		}
		await ctx.db.patch(invite._id, { recipientId: userId, redeemedAt: now });
		return goal._id;
	},
});

export const removeMember = mutation({
	args: { ...goalArgs, memberUserId: v.id('users') },
	handler: async (ctx, args) => {
		const userId = await actor(ctx, args);
		const goal = await authorize(ctx, args.goalId, userId, true);
		if (args.memberUserId === goal.ownerId)
			fail('FORBIDDEN', 'The owner cannot be removed.');
		const membership = await member(ctx, goal._id, args.memberUserId);
		if (!membership) fail('INVALID_INPUT', 'This user is not a goal member.');
		if (membership.removedAt === null)
			await ctx.db.patch(membership._id, {
				removedAt: new Date().toISOString(),
			});
		return { success: true as const };
	},
});

export const revokeInvite = mutation({
	args: { ...goalArgs, inviteId: v.id('goalInvites') },
	handler: async (ctx, args) => {
		const userId = await actor(ctx, args);
		await authorize(ctx, args.goalId, userId, true);
		const invite = await ctx.db.get(args.inviteId);
		if (!invite || invite.goalId !== args.goalId)
			fail('FORBIDDEN', 'This invitation does not belong to this goal.');
		if (invite.revokedAt === null)
			await ctx.db.patch(invite._id, { revokedAt: new Date().toISOString() });
		return { success: true as const };
	},
});

export const setArchived = mutation({
	args: { ...goalArgs, archived: v.boolean() },
	handler: async (ctx, args) => {
		const userId = await actor(ctx, args);
		const goal = await authorize(ctx, args.goalId, userId, true);
		if ((goal.archivedAt !== null) === args.archived)
			return { success: true as const };
		const now = new Date().toISOString();
		if (args.archived) {
			for (const invite of await liveInvites(ctx, goal._id, now)) {
				await ctx.db.patch(invite._id, { revokedAt: now });
			}
		}
		await ctx.db.patch(goal._id, { archivedAt: args.archived ? now : null });
		return { success: true as const };
	},
});
