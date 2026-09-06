import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

const personalFinanceCategory = v.union(
	v.object({
		primary: v.string(),
		detailed: v.string(),
		confidenceLevel: v.union(v.string(), v.null()),
	}),
	v.null(),
);

export default defineSchema({
	goals: defineTable({
		ownerId: v.id('users'),
		name: v.string(),
		currency: v.literal('USD'),
		method: v.literal('amount_grid'),
		targetCents: v.number(),
		minCellCents: v.number(),
		maxCellCents: v.number(),
		startDate: v.string(),
		targetDate: v.string(),
		cellAmountsCents: v.array(v.number()),
		gridRevision: v.number(),
		firstContributionAt: v.union(v.string(), v.null()),
		archivedAt: v.union(v.string(), v.null()),
	}).index('by_ownerId', ['ownerId']),

	goalMembers: defineTable({
		goalId: v.id('goals'),
		userId: v.id('users'),
		displayName: v.string(),
		colorIndex: v.number(),
		joinedAt: v.string(),
		removedAt: v.union(v.string(), v.null()),
	})
		.index('by_goalId_userId', ['goalId', 'userId'])
		.index('by_goalId', ['goalId'])
		.index('by_userId_removedAt', ['userId', 'removedAt']),

	goalContributions: defineTable({
		goalId: v.id('goals'),
		gridRevision: v.number(),
		cellIndex: v.number(),
		contributorId: v.id('users'),
		amountCents: v.number(),
		submissionId: v.string(),
		recordedAt: v.string(),
		undoneBy: v.union(v.id('users'), v.null()),
		undoneAt: v.union(v.string(), v.null()),
	})
		.index('by_goalId_undoneAt', ['goalId', 'undoneAt'])
		.index('by_goalId_cellIndex_undoneAt', ['goalId', 'cellIndex', 'undoneAt'])
		.index('by_goalId_contributorId_submissionId', [
			'goalId',
			'contributorId',
			'submissionId',
		]),

	goalInvites: defineTable({
		goalId: v.id('goals'),
		tokenHash: v.string(),
		creatorId: v.id('users'),
		createdAt: v.string(),
		expiresAt: v.string(),
		recipientId: v.union(v.id('users'), v.null()),
		redeemedAt: v.union(v.string(), v.null()),
		revokedAt: v.union(v.string(), v.null()),
	})
		.index('by_tokenHash', ['tokenHash'])
		.index('by_goalId_revokedAt_redeemedAt_expiresAt', [
			'goalId',
			'revokedAt',
			'redeemedAt',
			'expiresAt',
		]),

	goalActivity: defineTable(
		v.union(
			v.object({
				goalId: v.id('goals'),
				kind: v.literal('recorded'),
				actorId: v.id('users'),
				at: v.string(),
				submissionId: v.string(),
			}),
			v.object({
				goalId: v.id('goals'),
				kind: v.literal('undone'),
				actorId: v.id('users'),
				at: v.string(),
				contributionId: v.id('goalContributions'),
			}),
		),
	).index('by_goalId_at', ['goalId', 'at']),

	users: defineTable({
		clerkUserId: v.string(),
	}).index('by_clerkUserId', ['clerkUserId']),

	items: defineTable({
		userId: v.id('users'),
		itemId: v.string(),
		accessToken: v.string(),
		institutionId: v.string(),
		institutionName: v.string(),
		cursor: v.union(v.string(), v.null()),
		createdAt: v.string(),
		healthState: v.optional(
			v.union(
				v.literal('ok'),
				v.literal('reauth_required'),
				v.literal('consent_expiring'),
				v.literal('error'),
			),
		),
		healthErrorCode: v.optional(v.union(v.string(), v.null())),
		healthMessage: v.optional(v.union(v.string(), v.null())),
	})
		.index('by_userId', ['userId'])
		.index('by_itemId', ['itemId']),

	transactions: defineTable({
		userId: v.id('users'),
		itemId: v.string(),
		transactionId: v.string(),
		accountId: v.string(),
		amount: v.number(),
		date: v.string(),
		name: v.string(),
		merchantName: v.union(v.string(), v.null()),
		pending: v.boolean(),
		personalFinanceCategory,
		userCategoryPrimary: v.optional(v.string()),
		categoryIconUrl: v.union(v.string(), v.null()),
		logoUrl: v.union(v.string(), v.null()),
		website: v.union(v.string(), v.null()),
		isoCurrencyCode: v.union(v.string(), v.null()),
	})
		.index('by_userId_date', ['userId', 'date'])
		.index('by_itemId', ['itemId'])
		.index('by_transactionId', ['transactionId']),

	accounts: defineTable({
		userId: v.id('users'),
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
		.index('by_userId', ['userId'])
		.index('by_itemId', ['itemId']),
});
