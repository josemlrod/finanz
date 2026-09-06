import { afterAll, describe, expect, test } from 'bun:test';
import { anyApi, type ApiFromModules } from 'convex/server';
import { ConvexError } from 'convex/values';
import { convexTest } from 'convex-test';
import type * as goals from './goals';
import schema from './schema';

// Explicit module registration matches the other Convex tests, without codegen.
const modules = {
	'./_generated/api.js': () => import('./_generated/api.js'),
	'./goals.ts': () => import('./goals'),
};
const api = anyApi as ApiFromModules<{ goals: typeof goals }>;
const internalSecret = 'expected-secret';
const originalSecret = process.env.CONVEX_INTERNAL_SECRET;
afterAll(() => {
	if (originalSecret === undefined) delete process.env.CONVEX_INTERNAL_SECRET;
	else process.env.CONVEX_INTERNAL_SECRET = originalSecret;
});

const config = {
	name: ' Rainy day ',
	targetCents: 10_000,
	minCellCents: 1_000,
	maxCellCents: 2_000,
	startDate: '2026-01-01',
	targetDate: '2026-07-01',
};
const auth = (userId = 'owner') => ({ internalSecret, userId });

async function fixture(
	transactionLimits: boolean | { documentsRead: number } = true,
) {
	process.env.CONVEX_INTERNAL_SECRET = internalSecret;
	const t = convexTest({ schema, modules, transactionLimits });
	const ids = await t.run(async (ctx) => ({
		owner: await ctx.db.insert('users', { clerkUserId: 'owner' }),
		member: await ctx.db.insert('users', { clerkUserId: 'member' }),
		outsider: await ctx.db.insert('users', { clerkUserId: 'outsider' }),
	}));
	const goalId = await t.mutation(api.goals.create, {
		...auth(),
		config,
		displayName: 'Alex',
	});
	const owner = { ...auth(), goalId };
	const member = { ...auth('member'), goalId };
	const outsider = { ...auth('outsider'), goalId };
	const record = (submissionId = 'submission', cellIndexes = [0, 1]) => ({
		...owner,
		submissionId,
		cellIndexes,
		expectedGridRevision: 1,
	});
	const join = async (
		tokenHash = 'join-token',
		userId = 'member',
		displayName = 'Sam',
	) => {
		await t.mutation(api.goals.createInvite, { ...owner, tokenHash });
		return t.mutation(api.goals.acceptInvite, {
			...auth(userId),
			tokenHash,
			displayName,
		});
	};
	return { t, ids, goalId, owner, member, outsider, record, join };
}

async function rejectsCode(promise: Promise<unknown>, code: string) {
	try {
		await promise;
		throw new Error(`Expected ${code}`);
	} catch (error) {
		expect(error).toBeInstanceOf(ConvexError);
		const data = (error as ConvexError<{ code: string; message: string }>).data;
		expect(data.code).toBe(code);
		expect(data.message.length).toBeGreaterThan(0);
	}
}

describe('savings goals backend', () => {
	test('creates without Items, normalizes config, persists exact grid, and isolates reads', async () => {
		const { t, owner, outsider, ids, goalId } = await fixture();
		const detail = await t.query(api.goals.detail, owner);
		expect(detail?.goal.name).toBe('Rainy day');
		expect(detail?.goal.cellAmountsCents.reduce((a, b) => a + b, 0)).toBe(
			config.targetCents,
		);
		expect(detail?.viewer).toEqual({ userId: ids.owner, isOwner: true });
		expect(detail?.members).toHaveLength(1);
		expect(detail?.members[0]).toMatchObject({
			displayName: 'Alex',
			colorIndex: 0,
			recordedCents: 0,
			cellCount: 0,
		});
		expect(await t.query(api.goals.detail, owner)).toEqual(detail);
		expect(await t.query(api.goals.list, auth())).toMatchObject({
			page: [{ ...detail!.goal, recordedCents: 0, isOwner: true }],
			isDone: true,
			continueCursor: expect.any(String),
		});
		expect(await t.query(api.goals.list, auth('outsider'))).toMatchObject({
			page: [],
			isDone: true,
		});
		expect(await t.query(api.goals.detail, outsider)).toBeNull();
		await rejectsCode(t.query(api.goals.activity, outsider), 'FORBIDDEN');
		await t.run(async (ctx) => {
			await ctx.db.delete(goalId);
		});
		expect(await t.query(api.goals.detail, owner)).toBeNull();
	});

	test('all reads authenticate the secret and resolve a local user', async () => {
		const { t, owner } = await fixture();
		for (const credentials of [
			{ internalSecret: 'wrong', userId: 'owner' },
			auth('missing'),
		]) {
			await rejectsCode(t.query(api.goals.list, credentials), 'FORBIDDEN');
			await rejectsCode(
				t.query(api.goals.detail, { ...owner, ...credentials }),
				'FORBIDDEN',
			);
			await rejectsCode(
				t.query(api.goals.activity, { ...owner, ...credentials }),
				'FORBIDDEN',
			);
			await rejectsCode(
				t.query(api.goals.inspectInvite, {
					...credentials,
					tokenHash: 'unknown',
				}),
				'FORBIDDEN',
			);
			await rejectsCode(
				t.mutation(api.goals.create, {
					...credentials,
					config,
					displayName: 'Alex',
				}),
				'FORBIDDEN',
			);
		}
	});

	test('client reads derive goal access from the verified Clerk identity', async () => {
		const { t, goalId, join, ids } = await fixture();
		await join();

		const owner = t.withIdentity({ subject: 'owner' });
		const member = t.withIdentity({ subject: 'member' });
		const outsider = t.withIdentity({ subject: 'outsider' });

		expect(
			(await owner.query(api.goals.detailForCurrentUser, { goalId }))?.viewer,
		).toEqual({ userId: ids.owner, isOwner: true });
		expect(
			(await member.query(api.goals.detailForCurrentUser, { goalId }))?.viewer,
		).toEqual({ userId: ids.member, isOwner: false });
		expect(
			await outsider.query(api.goals.detailForCurrentUser, { goalId }),
		).toBeNull();
		expect(
			await outsider.query(api.goals.activityForCurrentUser, { goalId }),
		).toBeNull();
		await rejectsCode(
			t.query(api.goals.detailForCurrentUser, { goalId }),
			'FORBIDDEN',
		);
		await rejectsCode(
			t
				.withIdentity({ subject: 'missing' })
				.query(api.goals.activityForCurrentUser, { goalId }),
			'FORBIDDEN',
		);
	});

	test('rejects invalid config and normalizes trusted member identities', async () => {
		const { t } = await fixture();
		await rejectsCode(
			t.mutation(api.goals.create, {
				...auth(),
				config: { ...config, targetCents: 101 },
				displayName: 'Alex',
			}),
			'INVALID_INPUT',
		);
		for (const [displayName, expected] of [
			['   ', 'Goal member'],
			['private@example.com', 'private@example.com'],
			['  Alex\u0000  Smith  ', 'Alex Smith'],
		]) {
			const goalId = await t.mutation(api.goals.create, {
				...auth(),
				config,
				displayName,
			});
			expect(
				(await t.query(api.goals.detail, { ...auth(), goalId }))?.members[0]
					.displayName,
			).toBe(expected);
		}
	});

	test('every mutation rejects invalid credentials before state changes or idempotent returns', async () => {
		const { t, owner, record, ids } = await fixture();
		const result = await t.mutation(api.goals.record, record());
		const inviteId = await t.mutation(api.goals.createInvite, {
			...owner,
			tokenHash: 'auth-test',
		});
		for (const credentials of [
			{ internalSecret: 'wrong', userId: 'owner' },
			auth('missing'),
		]) {
			const goalAuth = { ...owner, ...credentials };
			await rejectsCode(
				t.mutation(api.goals.record, { ...record(), ...credentials }),
				'FORBIDDEN',
			);
			await rejectsCode(
				t.mutation(api.goals.undo, {
					...goalAuth,
					contributionId: result.contributionIds[0],
				}),
				'FORBIDDEN',
			);
			await rejectsCode(
				t.mutation(api.goals.edit, {
					...goalAuth,
					config,
					expectedGridRevision: 1,
				}),
				'FORBIDDEN',
			);
			await rejectsCode(
				t.mutation(api.goals.createInvite, { ...goalAuth, tokenHash: 'no' }),
				'FORBIDDEN',
			);
			await rejectsCode(
				t.mutation(api.goals.acceptInvite, {
					...credentials,
					tokenHash: 'auth-test',
					displayName: 'Name',
				}),
				'FORBIDDEN',
			);
			await rejectsCode(
				t.mutation(api.goals.removeMember, {
					...goalAuth,
					memberUserId: ids.member,
				}),
				'FORBIDDEN',
			);
			await rejectsCode(
				t.mutation(api.goals.revokeInvite, { ...goalAuth, inviteId }),
				'FORBIDDEN',
			);
			await rejectsCode(
				t.mutation(api.goals.setArchived, { ...goalAuth, archived: false }),
				'FORBIDDEN',
			);
		}
		expect(
			(await t.query(api.goals.detail, owner))?.contributions,
		).toHaveLength(2);
		expect((await t.query(api.goals.detail, owner))?.invites).toHaveLength(1);
	});

	test('active reads and paginated history stay within a 50-document budget despite accumulated history', async () => {
		const { t, owner, record } = await fixture({ documentsRead: 50 });
		for (let i = 0; i < 60; i++) {
			const result = await t.mutation(
				api.goals.record,
				record(`bounded-${i}`, [0]),
			);
			await t.mutation(api.goals.undo, {
				...owner,
				contributionId: result.contributionIds[0],
			});
			const inviteId = await t.mutation(api.goals.createInvite, {
				...owner,
				tokenHash: `bounded-${i}`,
			});
			await t.mutation(api.goals.revokeInvite, { ...owner, inviteId });
		}
		expect((await t.query(api.goals.detail, owner))?.contributions).toEqual([]);
		expect((await t.query(api.goals.list, auth())).page[0].recordedCents).toBe(
			0,
		);
		expect((await t.query(api.goals.activity, owner)).page).toHaveLength(20);
		await t.mutation(api.goals.createInvite, { ...owner, tokenHash: 'live' });
		await t.mutation(api.goals.setArchived, { ...owner, archived: true });
	});

	test('a maximum 500-cell confirmation, replay, detail and undo fit transaction limits', async () => {
		const { t } = await fixture();
		const goalId = await t.mutation(api.goals.create, {
			...auth(),
			config: {
				...config,
				targetCents: 50_000,
				minCellCents: 100,
				maxCellCents: 100,
			},
			displayName: 'Alex',
		});
		const args = {
			...auth(),
			goalId,
			cellIndexes: Array.from({ length: 500 }, (_, i) => i),
			expectedGridRevision: 1,
			submissionId: 'maximum',
		};
		const result = await t.mutation(api.goals.record, args);
		expect(result.contributionIds).toHaveLength(500);
		expect(result.recordedCents).toBe(50_000);
		expect(await t.mutation(api.goals.record, args)).toEqual(result);
		expect(
			(await t.query(api.goals.detail, { ...auth(), goalId }))?.contributions,
		).toHaveLength(500);
		expect(
			(await t.query(api.goals.activity, { ...auth(), goalId })).page[0]
				.contributions,
		).toHaveLength(500);
		await t.mutation(api.goals.undo, {
			...auth(),
			goalId,
			contributionId: result.contributionIds[0],
		});
		expect(
			(await t.query(api.goals.list, auth())).page.find(
				(goal) => goal._id === goalId,
			)?.recordedCents,
		).toBe(49_900);
	});

	test('list reaches every goal beyond 64 fully recorded goals within default transaction limits', async () => {
		const { t, ids, goalId: initialGoalId } = await fixture();
		const expected = {
			active: [initialGoalId],
			archived: [] as (typeof initialGoalId)[],
		};
		const now = new Date().toISOString();
		for (let i = 0; i < 78; i++) {
			const archived = i < 65;
			const goalId = await t.run(async (ctx) => {
				const goalId = await ctx.db.insert('goals', {
					...config,
					targetCents: 50_000,
					minCellCents: 100,
					maxCellCents: 100,
					ownerId: ids.owner,
					currency: 'USD',
					method: 'amount_grid',
					cellAmountsCents: Array(500).fill(100),
					gridRevision: 1,
					firstContributionAt: now,
					archivedAt: archived ? now : null,
				});
				await ctx.db.insert('goalMembers', {
					goalId,
					userId: ids.owner,
					displayName: 'Alex',
					colorIndex: 0,
					joinedAt: now,
					removedAt: null,
				});
				for (let cellIndex = 0; cellIndex < 500; cellIndex++) {
					await ctx.db.insert('goalContributions', {
						goalId,
						gridRevision: 1,
						cellIndex,
						contributorId: ids.owner,
						amountCents: 100,
						submissionId: 'fixture',
						recordedAt: now,
						undoneAt: null,
						undoneBy: null,
					});
				}
				return goalId;
			});
			expected[archived ? 'archived' : 'active'].push(goalId);
		}
		for (const archived of [false, true]) {
			const seen: (typeof initialGoalId)[] = [];
			let cursor: string | undefined;
			let emptyNonfinalPage = false;
			let done = false;
			for (let pageNumber = 0; pageNumber < 10; pageNumber++) {
				// Omit archived for the active view to exercise the API default.
				const result = await t.query(api.goals.list, {
					...auth(),
					...(cursor ? { cursor } : {}),
					...(archived ? { archived } : {}),
				});
				expect(result.page.length).toBeLessThanOrEqual(12);
				for (const goal of result.page) {
					expect(goal.archivedAt !== null).toBe(archived);
					expect(goal.recordedCents).toBe(
						goal._id === initialGoalId ? 0 : 50_000,
					);
					expect(goal.isOwner).toBe(true);
					seen.push(goal._id);
				}
				if (!result.page.length && !result.isDone) emptyNonfinalPage = true;
				if (result.isDone) {
					done = true;
					break;
				}
				expect(result.continueCursor).not.toBe(cursor);
				cursor = result.continueCursor;
			}
			expect(done).toBe(true);
			expect(seen).toEqual(expected[archived ? 'archived' : 'active']);
			expect(new Set(seen).size).toBe(seen.length);
			if (!archived) expect(emptyNonfinalPage).toBe(true);
		}
	}, 30_000);

	test('list filters archived goals before reading their Contributions', async () => {
		const { t, owner, ids, goalId } = await fixture({ documentsRead: 50 });
		await t.run(async (ctx) => {
			const now = new Date().toISOString();
			await ctx.db.patch(goalId, {
				targetCents: 50_000,
				minCellCents: 100,
				maxCellCents: 100,
				cellAmountsCents: Array(500).fill(100),
				firstContributionAt: now,
				archivedAt: now,
			});
			for (let cellIndex = 0; cellIndex < 500; cellIndex++) {
				await ctx.db.insert('goalContributions', {
					goalId,
					gridRevision: 1,
					cellIndex,
					contributorId: ids.owner,
					amountCents: 100,
					submissionId: 'fixture',
					recordedAt: now,
					undoneAt: null,
					undoneBy: null,
				});
			}
		});
		expect(await t.query(api.goals.list, auth())).toMatchObject({
			page: [],
			isDone: true,
		});
		await t.mutation(api.goals.setArchived, { ...owner, archived: false });
		expect(
			await t.query(api.goals.list, { ...auth(), archived: true }),
		).toMatchObject({ page: [], isDone: true });
	});

	test('records server amounts and timestamps, groups history, and replays the same cell set', async () => {
		const { t, owner, record } = await fixture();
		const before = new Date().toISOString();
		const outcome = await t.mutation(api.goals.record, record('one', [1, 0]));
		expect(await t.mutation(api.goals.record, record('one', [0, 1]))).toEqual(
			outcome,
		);
		const detail = (await t.query(api.goals.detail, owner))!;
		expect(detail.contributions).toHaveLength(2);
		expect(outcome.recordedCents).toBe(
			detail.goal.cellAmountsCents[0] + detail.goal.cellAmountsCents[1],
		);
		expect(detail.goal.firstContributionAt! >= before).toBe(true);
		expect(
			detail.contributions.every(
				(row) => row.recordedAt === detail.goal.firstContributionAt,
			),
		).toBe(true);
		expect((await t.query(api.goals.list, auth())).page[0].recordedCents).toBe(
			outcome.recordedCents,
		);
		const activity = await t.query(api.goals.activity, owner);
		expect(activity.page).toHaveLength(1);
		expect(activity.page[0]).toMatchObject({
			kind: 'recorded',
			submissionId: 'one',
		});
		expect(activity.page[0].contributions).toHaveLength(2);
		await rejectsCode(
			t.mutation(api.goals.record, record('one', [0])),
			'CONFLICT',
		);
		await rejectsCode(
			t.mutation(api.goals.record, {
				...record('one'),
				expectedGridRevision: 2,
			}),
			'CONFLICT',
		);
	});

	test('rejects invalid indexes and atomically rejects overlapping selections', async () => {
		const { t, owner, record } = await fixture();
		for (const indexes of [
			[],
			[0, 0],
			[-1],
			[0.5],
			[999],
			Array.from({ length: 501 }, (_, i) => i),
		]) {
			await rejectsCode(
				t.mutation(api.goals.record, record('bad', indexes)),
				'INVALID_INPUT',
			);
		}
		await rejectsCode(
			t.mutation(api.goals.record, record(' ')),
			'INVALID_INPUT',
		);
		await t.mutation(api.goals.record, record('first', [0]));
		await rejectsCode(
			t.mutation(api.goals.record, record('second', [1, 0])),
			'CONFLICT',
		);
		expect(
			(await t.query(api.goals.detail, owner))?.contributions.map(
				(row) => row.cellIndex,
			),
		).toEqual([0]);
		expect((await t.query(api.goals.activity, owner)).page).toHaveLength(1);
	});

	test('concurrent claims have one winner and concurrent retries return one outcome', async () => {
		const { t, owner, record, join, member } = await fixture();
		await join();
		const claims = await Promise.allSettled([
			t.mutation(api.goals.record, record('owner', [0, 1])),
			t.mutation(api.goals.record, { ...record('member', [1, 2]), ...member }),
		]);
		expect(
			claims.filter((result) => result.status === 'fulfilled'),
		).toHaveLength(1);
		expect(
			(await t.query(api.goals.detail, owner))?.contributions,
		).toHaveLength(2);
		const retries = await Promise.all([
			t.mutation(api.goals.record, record('retry', [3])),
			t.mutation(api.goals.record, record('retry', [3])),
		]);
		expect(retries[0]).toEqual(retries[1]);
		expect((await t.query(api.goals.activity, owner)).page).toHaveLength(2);
	});

	test('undo preserves history and replay, and cannot release a newer Contribution', async () => {
		const { t, owner, record } = await fixture();
		const initial = await t.mutation(api.goals.record, record());
		const contributionId = initial.contributionIds[0];
		await t.mutation(api.goals.undo, { ...owner, contributionId });
		const newer = await t.mutation(api.goals.record, record('newer', [0]));
		await t.mutation(api.goals.undo, { ...owner, contributionId });
		expect(await t.mutation(api.goals.record, record())).toEqual(initial);
		const detail = (await t.query(api.goals.detail, owner))!;
		expect(detail.contributions.map((row) => row._id)).toContain(
			newer.contributionIds[0],
		);
		expect(detail.contributions).toHaveLength(2);
		const events = (await t.query(api.goals.activity, owner)).page;
		expect(events).toHaveLength(3);
		const original = events.find(
			(event) =>
				event.kind === 'recorded' && event.submissionId === 'submission',
		)!;
		expect(
			original.contributions.find((row) => row._id === contributionId)
				?.undoneAt,
		).not.toBeNull();
		expect(
			original.contributions.find((row) => row._id !== contributionId)
				?.undoneAt,
		).toBeNull();
	});

	test('pagination returns 20 newest events and bounded current Contribution states', async () => {
		const { t, owner, record } = await fixture();
		for (let i = 0; i < 13; i++) {
			const result = await t.mutation(
				api.goals.record,
				record(`cycle-${i}`, [0]),
			);
			await t.mutation(api.goals.undo, {
				...owner,
				contributionId: result.contributionIds[0],
			});
		}
		const first = await t.query(api.goals.activity, owner);
		expect(first.page).toHaveLength(20);
		expect(first.isDone).toBe(false);
		const second = await t.query(api.goals.activity, {
			...owner,
			cursor: first.continueCursor,
		});
		expect(second.page).toHaveLength(6);
		expect(second.isDone).toBe(true);
		const events = [...first.page, ...second.page];
		expect(new Set(events.map((event) => event._id)).size).toBe(26);
		expect(events.map((event) => event.at)).toEqual(
			events
				.map((event) => event.at)
				.sort()
				.reverse(),
		);
		expect(
			events.every(
				(event) =>
					event.contributions.length === 1 &&
					event.contributions[0].undoneAt !== null,
			),
		).toBe(true);
		expect((await t.query(api.goals.detail, owner))?.contributions).toEqual([]);
	});

	test('grid changes reject stale selections and first Contribution permanently locks configuration', async () => {
		const { t, owner, record } = await fixture();
		const changed = { ...config, targetCents: 12_000 };
		await t.mutation(api.goals.edit, {
			...owner,
			config: changed,
			expectedGridRevision: 1,
		});
		expect((await t.query(api.goals.detail, owner))?.goal.gridRevision).toBe(2);
		await rejectsCode(t.mutation(api.goals.record, record()), 'GRID_CHANGED');
		await rejectsCode(
			t.mutation(api.goals.edit, { ...owner, config, expectedGridRevision: 1 }),
			'GRID_CHANGED',
		);
		const result = await t.mutation(api.goals.record, {
			...record('new-grid', [0]),
			expectedGridRevision: 2,
		});
		await t.mutation(api.goals.undo, {
			...owner,
			contributionId: result.contributionIds[0],
		});
		for (const locked of [
			{ targetCents: 13_000 },
			{ minCellCents: 900 },
			{ maxCellCents: 2_100 },
			{ startDate: '2025-12-01' },
		]) {
			await rejectsCode(
				t.mutation(api.goals.edit, {
					...owner,
					config: { ...changed, ...locked },
					expectedGridRevision: 2,
				}),
				'LOCKED',
			);
		}
		const before = (await t.query(api.goals.detail, owner))!.goal;
		await t.mutation(api.goals.edit, {
			...owner,
			config: { ...changed, name: 'New name', targetDate: '2027-01-01' },
			expectedGridRevision: 2,
		});
		const after = (await t.query(api.goals.detail, owner))!.goal;
		expect(after.cellAmountsCents).toEqual(before.cellAmountsCents);
		expect(after.firstContributionAt).toBe(before.firstContributionAt);
		expect(after.gridRevision).toBe(2);
		expect(after.name).toBe('New name');
	});

	test('start-date-only edits do not change grid identity, and dates never prevent recording', async () => {
		const { t, owner, record } = await fixture();
		const before = (await t.query(api.goals.detail, owner))!.goal;
		await t.mutation(api.goals.edit, {
			...owner,
			config: { ...config, startDate: '2099-01-01', targetDate: '2099-07-01' },
			expectedGridRevision: 1,
		});
		const after = (await t.query(api.goals.detail, owner))!.goal;
		expect(after.cellAmountsCents).toEqual(before.cellAmountsCents);
		expect(after.gridRevision).toBe(1);
		expect((await t.mutation(api.goals.record, record())).success).toBe(true);
	});

	test('a grid edit racing the first Contribution cannot bypass the lock', async () => {
		for (const editFirst of [true, false]) {
			const { t, owner, record } = await fixture();
			const edit = () =>
				t.mutation(api.goals.edit, {
					...owner,
					config: { ...config, targetCents: 12_000 },
					expectedGridRevision: 1,
				});
			const claim = () => t.mutation(api.goals.record, record());
			const results = await Promise.allSettled(
				editFirst ? [edit(), claim()] : [claim(), edit()],
			);
			expect(
				results.filter((result) => result.status === 'fulfilled'),
			).toHaveLength(1);
			const detail = (await t.query(api.goals.detail, owner))!;
			if (detail.contributions.length) {
				expect(detail.goal.targetCents).toBe(config.targetCents);
				expect(detail.goal.firstContributionAt).not.toBeNull();
			} else {
				expect(detail.goal.gridRevision).toBe(2);
			}
		}
	});

	test('inspect is read-only; eligible explicit acceptance consumes the invite once', async () => {
		const { t, owner, member, ids, goalId } = await fixture();
		const tokenHash = 'invite';
		const inviteId = await t.mutation(api.goals.createInvite, {
			...owner,
			tokenHash,
		});
		for (let i = 0; i < 2; i++) {
			expect(
				await t.query(api.goals.inspectInvite, {
					...auth('member'),
					tokenHash,
				}),
			).toEqual({ goalName: 'Rainy day', eligible: true });
		}
		expect(
			await t.query(api.goals.inspectInvite, { ...auth(), tokenHash }),
		).toEqual({ goalName: 'Rainy day', eligible: false });
		await rejectsCode(
			t.mutation(api.goals.acceptInvite, {
				...auth(),
				tokenHash,
				displayName: 'Alex',
			}),
			'INVITE_UNAVAILABLE',
		);
		const invite = await t.run((ctx) => ctx.db.get(inviteId));
		expect(Date.parse(invite!.expiresAt) - Date.parse(invite!.createdAt)).toBe(
			7 * 24 * 60 * 60 * 1000,
		);
		expect(invite!.redeemedAt).toBeNull();
		expect(
			await t.mutation(api.goals.acceptInvite, {
				...auth('member'),
				tokenHash,
				displayName: 'Sam',
			}),
		).toBe(goalId);
		expect((await t.query(api.goals.detail, member))?.viewer).toEqual({
			userId: ids.member,
			isOwner: false,
		});
		expect(
			await t.query(api.goals.inspectInvite, {
				...auth('outsider'),
				tokenHash,
			}),
		).toBeNull();
		await rejectsCode(
			t.mutation(api.goals.acceptInvite, {
				...auth('outsider'),
				tokenHash,
				displayName: 'Other',
			}),
			'INVITE_UNAVAILABLE',
		);
	});

	test('first eligible recipient wins concurrent invite redemption', async () => {
		const { t, owner } = await fixture();
		await t.mutation(api.goals.createInvite, { ...owner, tokenHash: 'race' });
		const results = await Promise.allSettled(
			['member', 'outsider'].map((userId) =>
				t.mutation(api.goals.acceptInvite, {
					...auth(userId),
					tokenHash: 'race',
					displayName: 'Person',
				}),
			),
		);
		expect(
			results.filter((result) => result.status === 'fulfilled'),
		).toHaveLength(1);
		expect((await t.query(api.goals.detail, owner))?.members).toHaveLength(2);
	});

	test('active members cannot consume invites or see their metadata; owners never receive hashes', async () => {
		const { t, owner, member, join } = await fixture();
		await join();
		await t.mutation(api.goals.createInvite, { ...owner, tokenHash: 'second' });
		expect(
			await t.query(api.goals.inspectInvite, {
				...auth('member'),
				tokenHash: 'second',
			}),
		).toEqual({ goalName: 'Rainy day', eligible: false });
		await rejectsCode(
			t.mutation(api.goals.acceptInvite, {
				...auth('member'),
				tokenHash: 'second',
				displayName: 'Sam',
			}),
			'INVITE_UNAVAILABLE',
		);
		const detail = (await t.query(api.goals.detail, owner))!;
		expect(detail.invites).toHaveLength(1);
		expect('tokenHash' in detail.invites[0]).toBe(false);
		expect((await t.query(api.goals.detail, member))?.invites).toEqual([]);
		expect(JSON.stringify(detail)).not.toContain('clerkUserId');
	});

	test('membership removal preserves totals, history, snapshots and colors; rejoin reuses the row', async () => {
		const { t, owner, member, join, ids, record } = await fixture();
		await join();
		const result = await t.mutation(api.goals.record, {
			...record(),
			...member,
		});
		const original = (await t.query(api.goals.detail, owner))!.members.find(
			(row) => row.userId === ids.member,
		)!;
		await t.mutation(api.goals.removeMember, {
			...owner,
			memberUserId: ids.member,
		});
		expect(await t.query(api.goals.detail, member)).toBeNull();
		expect(await t.query(api.goals.list, auth('member'))).toMatchObject({
			page: [],
			isDone: true,
		});
		await rejectsCode(t.query(api.goals.activity, member), 'FORBIDDEN');
		await rejectsCode(
			t.mutation(api.goals.record, { ...record(), ...member }),
			'FORBIDDEN',
		);
		await rejectsCode(
			t.mutation(api.goals.undo, {
				...member,
				contributionId: result.contributionIds[0],
			}),
			'FORBIDDEN',
		);
		const removed = (await t.query(api.goals.detail, owner))!;
		expect(removed.contributions).toHaveLength(2);
		expect(
			removed.members.find((row) => row.userId === ids.member)?.recordedCents,
		).toBe(result.recordedCents);
		await join('return', 'member', 'sam@example.com');
		const rejoined = (await t.query(api.goals.detail, owner))!;
		expect(rejoined.members).toHaveLength(2);
		expect(rejoined.members.find((row) => row.userId === ids.member)).toEqual({
			...original,
			displayName: 'sam@example.com',
			removedAt: null,
		});
		expect(
			await t.mutation(api.goals.record, { ...record(), ...member }),
		).toEqual(result);
		await rejectsCode(
			t.mutation(api.goals.removeMember, { ...owner, memberUserId: ids.owner }),
			'FORBIDDEN',
		);
	});

	test('members record only themselves and undo only their own; owners can correct anyone', async () => {
		const { t, owner, member, outsider, join, record, ids } = await fixture();
		await join();
		const owned = await t.mutation(api.goals.record, record('same', [0]));
		const shared = await t.mutation(api.goals.record, {
			...record('same', [1]),
			...member,
		});
		await rejectsCode(
			t.mutation(api.goals.undo, {
				...member,
				contributionId: owned.contributionIds[0],
			}),
			'FORBIDDEN',
		);
		await rejectsCode(
			t.mutation(api.goals.record, { ...record('outside', [2]), ...outsider }),
			'FORBIDDEN',
		);
		await t.mutation(api.goals.undo, {
			...owner,
			contributionId: shared.contributionIds[0],
		});
		const undone = await t.run((ctx) => ctx.db.get(shared.contributionIds[0]));
		expect(undone).toMatchObject({
			contributorId: ids.member,
			undoneBy: ids.owner,
		});
		const ownAgain = await t.mutation(api.goals.record, {
			...record('again', [1]),
			...member,
		});
		await t.mutation(api.goals.undo, {
			...member,
			contributionId: ownAgain.contributionIds[0],
		});
		const secondGoal = await t.mutation(api.goals.create, {
			...auth(),
			config,
			displayName: 'Alex',
		});
		await rejectsCode(
			t.mutation(api.goals.undo, {
				...owner,
				goalId: secondGoal,
				contributionId: owned.contributionIds[0],
			}),
			'FORBIDDEN',
		);
	});

	test('members cannot perform owner operations', async () => {
		const { t, owner, member, join, ids } = await fixture();
		await join();
		const inviteId = await t.mutation(api.goals.createInvite, {
			...owner,
			tokenHash: 'owner-only',
		});
		await rejectsCode(
			t.mutation(api.goals.edit, {
				...member,
				config,
				expectedGridRevision: 1,
			}),
			'FORBIDDEN',
		);
		await rejectsCode(
			t.mutation(api.goals.createInvite, { ...member, tokenHash: 'no' }),
			'FORBIDDEN',
		);
		await rejectsCode(
			t.mutation(api.goals.revokeInvite, { ...member, inviteId }),
			'FORBIDDEN',
		);
		await rejectsCode(
			t.mutation(api.goals.removeMember, {
				...member,
				memberUserId: ids.owner,
			}),
			'FORBIDDEN',
		);
		await rejectsCode(
			t.mutation(api.goals.setArchived, { ...member, archived: true }),
			'FORBIDDEN',
		);
	});

	test('invalid, expired, revoked, consumed, and archived invitations reveal no goal', async () => {
		const { t, owner } = await fixture();
		const expiredId = await t.mutation(api.goals.createInvite, {
			...owner,
			tokenHash: 'expired',
		});
		await t.run(async (ctx) => {
			await ctx.db.patch(expiredId, { expiresAt: '2000-01-01T00:00:00.000Z' });
		});
		const revokedId = await t.mutation(api.goals.createInvite, {
			...owner,
			tokenHash: 'revoked',
		});
		await t.mutation(api.goals.revokeInvite, { ...owner, inviteId: revokedId });
		for (const tokenHash of ['missing', 'expired', 'revoked']) {
			expect(
				await t.query(api.goals.inspectInvite, {
					...auth('member'),
					tokenHash,
				}),
			).toBeNull();
			await rejectsCode(
				t.mutation(api.goals.acceptInvite, {
					...auth('member'),
					tokenHash,
					displayName: 'Sam',
				}),
				'INVITE_UNAVAILABLE',
			);
		}
		const otherGoal = await t.mutation(api.goals.create, {
			...auth(),
			config,
			displayName: 'Alex',
		});
		await rejectsCode(
			t.mutation(api.goals.revokeInvite, {
				...owner,
				goalId: otherGoal,
				inviteId: revokedId,
			}),
			'FORBIDDEN',
		);
		await rejectsCode(
			t.mutation(api.goals.createInvite, { ...owner, tokenHash: 'revoked' }),
			'CONFLICT',
		);
	});

	test('the 20 outstanding invite cap excludes expiry and handles concurrent creation', async () => {
		const { t, owner } = await fixture();
		const expired = await t.mutation(api.goals.createInvite, {
			...owner,
			tokenHash: 'expired',
		});
		await t.run(async (ctx) => {
			await ctx.db.patch(expired, { expiresAt: '2000-01-01T00:00:00.000Z' });
		});
		for (let i = 0; i < 19; i++)
			await t.mutation(api.goals.createInvite, {
				...owner,
				tokenHash: `live-${i}`,
			});
		const results = await Promise.allSettled(
			['last-a', 'last-b'].map((tokenHash) =>
				t.mutation(api.goals.createInvite, { ...owner, tokenHash }),
			),
		);
		expect(
			results.filter((result) => result.status === 'fulfilled'),
		).toHaveLength(1);
		await rejectsCode(
			t.mutation(api.goals.createInvite, { ...owner, tokenHash: 'over-limit' }),
			'INVITE_LIMIT',
		);
		const detail = (await t.query(api.goals.detail, owner))!;
		expect(detail.invites).toHaveLength(20);
		await t.mutation(api.goals.revokeInvite, {
			...owner,
			inviteId: detail.invites[0]._id,
		});
		await t.mutation(api.goals.createInvite, {
			...owner,
			tokenHash: 'replacement',
		});
		await t.mutation(api.goals.setArchived, { ...owner, archived: true });
		const rows = await t.run((ctx) => ctx.db.query('goalInvites').collect());
		expect(
			rows
				.filter((row) => row.expiresAt > new Date().toISOString())
				.every((row) => row.revokedAt !== null),
		).toBe(true);
	});

	test('archive freezes activity/settings but allows access revocation; unarchive restores neither links nor members', async () => {
		const { t, owner, member, record, join, ids } = await fixture();
		await join();
		const contribution = await t.mutation(api.goals.record, record());
		const inviteId = await t.mutation(api.goals.createInvite, {
			...owner,
			tokenHash: 'outstanding',
		});
		const before = (await t.query(api.goals.detail, owner))!.goal;
		await t.mutation(api.goals.setArchived, { ...owner, archived: true });
		expect(await t.query(api.goals.detail, member)).not.toBeNull();
		expect((await t.query(api.goals.activity, member)).page).toHaveLength(1);
		await rejectsCode(
			t.mutation(api.goals.record, record('blocked', [2])),
			'ARCHIVED',
		);
		await rejectsCode(
			t.mutation(api.goals.undo, {
				...owner,
				contributionId: contribution.contributionIds[0],
			}),
			'ARCHIVED',
		);
		await rejectsCode(
			t.mutation(api.goals.edit, { ...owner, config, expectedGridRevision: 1 }),
			'ARCHIVED',
		);
		await rejectsCode(
			t.mutation(api.goals.createInvite, { ...owner, tokenHash: 'blocked' }),
			'ARCHIVED',
		);
		expect(
			await t.query(api.goals.inspectInvite, {
				...auth('outsider'),
				tokenHash: 'outstanding',
			}),
		).toBeNull();
		await rejectsCode(
			t.mutation(api.goals.acceptInvite, {
				...auth('outsider'),
				tokenHash: 'outstanding',
				displayName: 'Other',
			}),
			'INVITE_UNAVAILABLE',
		);
		await t.mutation(api.goals.removeMember, {
			...owner,
			memberUserId: ids.member,
		});
		await t.mutation(api.goals.revokeInvite, { ...owner, inviteId });
		await t.mutation(api.goals.setArchived, { ...owner, archived: false });
		expect(await t.query(api.goals.detail, member)).toBeNull();
		expect(
			await t.query(api.goals.inspectInvite, {
				...auth('outsider'),
				tokenHash: 'outstanding',
			}),
		).toBeNull();
		expect((await t.query(api.goals.detail, owner))!.goal).toEqual(before);
		await t.mutation(api.goals.undo, {
			...owner,
			contributionId: contribution.contributionIds[0],
		});
	});

	test('redemption racing revoke or archive has a serializable outcome', async () => {
		for (const operation of ['revoke', 'archive'] as const) {
			for (const acceptFirst of [true, false]) {
				const { t, owner, member } = await fixture();
				const inviteId = await t.mutation(api.goals.createInvite, {
					...owner,
					tokenHash: 'race',
				});
				const accept = () =>
					t.mutation(api.goals.acceptInvite, {
						...auth('member'),
						tokenHash: 'race',
						displayName: 'Sam',
					});
				const invalidate = () =>
					operation === 'revoke'
						? t.mutation(api.goals.revokeInvite, { ...owner, inviteId })
						: t.mutation(api.goals.setArchived, { ...owner, archived: true });
				const results = await Promise.allSettled(
					acceptFirst ? [accept(), invalidate()] : [invalidate(), accept()],
				);
				const accepted = results[acceptFirst ? 0 : 1].status === 'fulfilled';
				expect((await t.query(api.goals.detail, member)) !== null).toBe(
					accepted,
				);
				expect(
					await t.query(api.goals.inspectInvite, {
						...auth('outsider'),
						tokenHash: 'race',
					}),
				).toBeNull();
				if (operation === 'archive') {
					await t.mutation(api.goals.setArchived, {
						...owner,
						archived: false,
					});
					expect(
						await t.query(api.goals.inspectInvite, {
							...auth('outsider'),
							tokenHash: 'race',
						}),
					).toBeNull();
				}
			}
		}
	});
});
