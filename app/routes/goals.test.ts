import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { ConvexError } from 'convex/values';

// Bun module mocks survive between files. Register them only in a child process.
if (process.env.FINANZ_GOAL_ROUTE_TEST_CHILD !== '1') {
	test('savings route contracts in an isolated process', async () => {
		const child = Bun.spawn([process.execPath, 'test', import.meta.path], {
			env: { ...process.env, FINANZ_GOAL_ROUTE_TEST_CHILD: '1' },
			stdout: 'pipe',
			stderr: 'pipe',
		});
		const [exitCode, stdout, stderr] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]);
		expect({ exitCode, output: exitCode === 0 ? '' : stdout + stderr }).toEqual(
			{ exitCode: 0, output: '' },
		);
	}, 30_000);
} else {
	const userId = 'authenticated-goal-member';
	const displayName = 'Authenticated Member';
	const goalId = 'goal_from_path';
	const token = 'a'.repeat(43);
	const config = {
		name: 'Rainy day',
		targetCents: 10000,
		minCellCents: 1000,
		maxCellCents: 2000,
		startDate: '2026-01-01',
		targetDate: '2027-01-01',
	};
	const auth = mock(async (_args: unknown) => ({ userId }));
	const getUser = mock(async (_userId: string) => ({
		firstName: 'Authenticated',
		lastName: 'Member',
		username: null as string | null,
		primaryEmailAddressId: 'email_primary',
		emailAddresses: [
			{ id: 'email_primary', emailAddress: 'member@example.com' },
		],
	}));
	const getConvexClient = mock(() => {
		throw new Error('Unexpected database access in route tests');
	});
	mock.module('~/lib/auth.server', () => ({ requirePageAuth: auth }));
	mock.module('@clerk/react-router/server', () => ({
		clerkClient: () => ({ users: { getUser } }),
	}));
	mock.module('~/lib/convex.server', () => ({ getConvexClient }));
	mock.module('~/lib/env.server', () => ({
		env: { CONVEX_INTERNAL_SECRET: 'test-only' },
	}));

	// Capture real pure functions before replacing the adapter, never import a
	// mocked module expecting to recover its original implementation.
	const { readGoalConfig, goalError, savingsHeaders, getGoalDisplayName } =
		await import('~/lib/goals/convex-goal-store.server');
	const store = {
		list: mock(
			async (_options: {
				cursor?: string;
				archived?: boolean;
			}): Promise<{
				page: unknown[];
				continueCursor: string;
				isDone: boolean;
			}> => ({ page: [], continueCursor: '', isDone: true }),
		),
		detail: mock(
			async (_id: string): Promise<unknown> => ({ goal: { _id: goalId } }),
		),
		activity: mock(
			async (_id: string, _cursor?: string): Promise<unknown> => ({
				page: [],
				isDone: true,
				continueCursor: '',
			}),
		),
		create: mock(async (_config: unknown, _name: string) => goalId),
		record: mock(async (_id: string, _input: unknown) => ({
			recordedCents: 3000,
		})),
		undo: mock(async (_id: string, _contributionId: string) => {}),
		edit: mock(async (_id: string, _config: unknown, _revision: number) => {}),
		createInvite: mock(async (_id: string) => ({
			token,
			inviteId: 'invite_created',
		})),
		removeMember: mock(async (_id: string, _memberId: string) => {}),
		revokeInvite: mock(async (_id: string, _inviteId: string) => {}),
		setArchived: mock(async (_id: string, _archived: boolean) => {}),
		inspectInvite: mock(
			async (_token: string): Promise<unknown> => ({
				goalName: config.name,
				eligible: true,
			}),
		),
		acceptInvite: mock(async (_token: string, _name: string) => goalId),
	};
	const goalStore = mock((_actor: string) => store);
	mock.module('~/lib/goals/convex-goal-store.server', () => ({
		readGoalConfig,
		goalError,
		savingsHeaders,
		getGoalDisplayName,
		goalStore,
	}));
	const goals = await import('./goals');
	const detail = await import('./goal-detail');
	const invite = await import('./goal-invite');

	type Args = Parameters<typeof detail.action>[0];
	type DataResult = { data: unknown; init?: ResponseInit };
	function args(
		fields?: Record<string, string | string[]>,
		options: { method?: string; path?: string } = {},
	): Args {
		const method = options.method ?? (fields ? 'POST' : 'GET');
		const body = new FormData();
		for (const [key, value] of Object.entries(fields ?? {})) {
			for (const entry of Array.isArray(value) ? value : [value])
				body.append(key, entry);
		}
		return {
			request: new Request(
				`http://localhost${options.path ?? `/goals/${goalId}`}`,
				{
					method,
					...(method === 'GET' || method === 'HEAD' ? {} : { body }),
				},
			),
			params: { goalId, token },
			context: {},
		} as unknown as Args;
	}
	function configFields() {
		return Object.fromEntries(
			Object.entries(config).map(([key, value]) => [key, String(value)]),
		);
	}
	const recordFields = {
		intent: 'record',
		requestId: 'request-1',
		submissionId: 'stable-submission',
		expectedGridRevision: '3',
		cellIndexes: ['0', '2'],
	};
	const spoofed = {
		userId: 'attacker',
		actorId: 'attacker',
		ownerId: 'attacker',
		displayName: 'Spoofed Name',
		goalId: 'spoofed_goal',
		token: 'spoofed_token',
	};
	function checkHeaders(value: HeadersInit | undefined) {
		const headers = new Headers(value);
		expect(headers.get('Cache-Control')).toBe('no-store');
		expect(headers.get('Referrer-Policy')).toBe('no-referrer');
	}
	function checkData(result: DataResult, status = 200) {
		expect(result.init?.status ?? 200).toBe(status);
		checkHeaders(result.init?.headers);
	}
	function checkRedirect(result: unknown) {
		expect(result).toBeInstanceOf(Response);
		const response = result as Response;
		expect(response.status).toBe(302);
		expect(response.headers.get('Location')).toBe(`/goals/${goalId}`);
		checkHeaders(response.headers);
	}
	async function thrown(
		operation: () => Promise<unknown>,
	): Promise<DataResult> {
		try {
			await operation();
		} catch (error) {
			return error as DataResult;
		}
		throw new Error('Expected loader/action to throw');
	}
	function failure(code: string, message = 'Safe domain error') {
		return new ConvexError({ code, message });
	}
	function noMutations() {
		for (const key of [
			'create',
			'record',
			'undo',
			'edit',
			'createInvite',
			'removeMember',
			'revokeInvite',
			'setArchived',
			'acceptInvite',
		] as const) {
			expect(store[key]).not.toHaveBeenCalled();
		}
	}

	beforeEach(() => {
		auth.mockReset();
		auth.mockImplementation(async () => ({ userId }));
		getUser.mockReset();
		getUser.mockImplementation(async () => ({
			firstName: 'Authenticated',
			lastName: 'Member',
			username: null,
			primaryEmailAddressId: 'email_primary',
			emailAddresses: [
				{ id: 'email_primary', emailAddress: 'member@example.com' },
			],
		}));
		goalStore.mockClear();
		getConvexClient.mockClear();
		for (const operation of Object.values(store)) operation.mockClear();
	});

	describe('authentication and privacy', () => {
		for (const [name, route] of [
			['goals', goals],
			['detail', detail],
			['invite', invite],
		] as const) {
			test(`${name} document headers prevent caching and referrer disclosure`, () => {
				checkHeaders(route.headers({} as never));
			});
			for (const kind of ['loader', 'action'] as const) {
				test(`${name} ${kind} authenticates before touching the store or profile`, async () => {
					const redirect = new Response(null, {
						status: 302,
						headers: { Location: '/sign-in', ...savingsHeaders },
					});
					auth.mockImplementationOnce(async () => {
						throw redirect;
					});
					const input = args(
						kind === 'action' ? { intent: 'accept' } : undefined,
					);
					await expect(route[kind](input as never)).rejects.toBe(redirect);
					expect(auth).toHaveBeenCalledWith(input);
					expect(goalStore).not.toHaveBeenCalled();
					expect(getUser).not.toHaveBeenCalled();
					expect(getConvexClient).not.toHaveBeenCalled();
				});
			}
		}
		test('invite metadata also suppresses referrers', () => {
			expect(invite.meta({} as never)).toContainEqual({
				name: 'referrer',
				content: 'no-referrer',
			});
		});
	});

	describe('goals list and create', () => {
		test('forwards list pagination without dropping the archive filter', async () => {
			const result = await goals.loader(
				args(undefined, {
					path: '/goals?view=archived&cursor=next-page',
				}) as never,
			);
			checkData(result);
			expect(store.list).toHaveBeenCalledWith({
				cursor: 'next-page',
				archived: true,
			});
			expect(result.data.cursor).toBe('next-page');
		});
		for (const cursor of ['', 'x'.repeat(8193)]) {
			test(`rejects ${cursor ? 'oversized' : 'empty'} list cursor`, async () => {
				checkData(
					await thrown(() =>
						goals.loader(
							args(undefined, { path: `/goals?cursor=${cursor}` }) as never,
						),
					),
					400,
				);
				expect(store.list).not.toHaveBeenCalled();
			});
		}
		for (const view of ['', '?view=archived', '?view=other']) {
			test(`loads authenticated goals and computes progress for ${view || 'active view'}`, async () => {
				store.list.mockResolvedValueOnce({
					page: [
						{ ...config, _id: goalId, recordedCents: 3000, archivedAt: null },
					],
					continueCursor: '',
					isDone: true,
				});
				const input = args(undefined, { path: `/goals${view}` });
				const result = await goals.loader(input as never);
				checkData(result);
				expect(auth).toHaveBeenCalledWith(input);
				expect(goalStore).toHaveBeenCalledWith(userId);
				expect(store.list).toHaveBeenCalledWith({
					cursor: undefined,
					archived: view === '?view=archived',
				});
				expect(result.data.archived).toBe(view === '?view=archived');
				expect(result.data.goals[0].progress).toMatchObject({
					recordedCents: 3000,
					remainingCents: 7000,
					percent: 30,
				});
			});
		}
		test('creates with parsed config and authenticated profile, ignoring spoofed identity', async () => {
			const input = args({
				...configFields(),
				...spoofed,
				name: '  Rainy day  ',
			});
			checkRedirect(await goals.action(input as never));
			expect(auth).toHaveBeenCalledWith(input);
			expect(goalStore).toHaveBeenCalledWith(userId);
			expect(getUser).toHaveBeenCalledWith(userId);
			expect(store.create.mock.calls).toEqual([[config, displayName]]);
		});
		for (const method of ['GET', 'PUT', 'DELETE']) {
			test(`create rejects ${method}`, async () => {
				checkData(
					(await goals.action(
						args(configFields(), { method }) as never,
					)) as DataResult,
					405,
				);
				noMutations();
				expect(getUser).not.toHaveBeenCalled();
			});
		}
		for (const [field, value] of [
			['name', ' '],
			['targetCents', '1e4'],
			['targetCents', '100.5'],
			['targetCents', '-100'],
			['targetCents', '900719925474099200'],
			['minCellCents', '0'],
			['targetDate', '2026-02-30'],
			['targetDate', '2025-01-01'],
		]) {
			test(`create rejects invalid ${field}=${value}`, async () => {
				checkData(
					(await goals.action(
						args({ ...configFields(), [field]: value }) as never,
					)) as DataResult,
					400,
				);
				noMutations();
				expect(getUser).not.toHaveBeenCalled();
			});
		}
		test('create rejects missing config fields', async () => {
			checkData(
				(await goals.action(
					args({ name: 'Only a name' }) as never,
				)) as DataResult,
				400,
			);
			noMutations();
		});
		test('list throws safe errors with privacy headers', async () => {
			store.list.mockRejectedValueOnce(
				new Error(`secret database URL /invites/${token}`),
			);
			const result = await thrown(() => goals.loader(args() as never));
			checkData(result, 503);
			expect(result.data).toEqual({ message: goalError(null).message });
		});
		test('create returns safe storage failures with privacy headers', async () => {
			store.create.mockRejectedValueOnce(new Error(token));
			const result = (await goals.action(
				args(configFields()) as never,
			)) as DataResult;
			checkData(result, 503);
			expect(result.data).toEqual({ error: goalError(null).message });
		});
	});

	describe('goal detail loader', () => {
		for (const cursor of [undefined, 'opaque+/cursor=']) {
			test(`forwards goal and ${cursor ? 'activity cursor' : 'first-page request'} for the authenticated actor`, async () => {
				const input = args(undefined, {
					path: `/goals/${goalId}${cursor ? `?activityCursor=${encodeURIComponent(cursor)}` : ''}`,
				});
				const result = await detail.loader(input);
				checkData(result);
				expect(auth).toHaveBeenCalledWith(input);
				expect(goalStore).toHaveBeenCalledWith(userId);
				expect(store.detail.mock.calls).toEqual([[goalId]]);
				expect(store.activity.mock.calls).toEqual([[goalId, cursor]]);
				expect(result.data.detail).toEqual({ goal: { _id: goalId } });
				expect(result.data.activity).toEqual({
					page: [],
					isDone: true,
					continueCursor: '',
				});
				expect(new Date(result.data.snapshotAt).toISOString()).toBe(
					result.data.snapshotAt,
				);
				expect(result.data.today).toBe(result.data.snapshotAt.slice(0, 10));
			});
		}
		for (const cursor of ['', 'x'.repeat(8193)]) {
			test(`rejects ${cursor ? 'oversized' : 'empty'} activity cursors before reads`, async () => {
				checkData(
					await thrown(() =>
						detail.loader(
							args(undefined, {
								path: `/goals/${goalId}?activityCursor=${cursor}`,
							}),
						),
					),
					400,
				);
				expect(store.detail).not.toHaveBeenCalled();
				expect(store.activity).not.toHaveBeenCalled();
			});
		}
		test('missing detail never fetches activity', async () => {
			store.detail.mockResolvedValueOnce(null);
			checkData(await thrown(() => detail.loader(args())), 404);
			expect(store.activity).not.toHaveBeenCalled();
		});
		test('missing activity discards already-fetched detail', async () => {
			store.activity.mockResolvedValueOnce(null);
			const result = await thrown(() => detail.loader(args()));
			checkData(result, 404);
			expect(result.data).toBe('Goal not found or access removed.');
		});
		for (const operation of ['detail', 'activity'] as const) {
			test(`forbidden ${operation} throws instead of returning partial detail`, async () => {
				store[operation].mockRejectedValueOnce(failure('FORBIDDEN'));
				const result = await thrown(() => detail.loader(args()));
				checkData(result, 403);
				expect(result.data).toBe('Safe domain error');
				if (operation === 'detail')
					expect(store.activity).not.toHaveBeenCalled();
			});
		}
	});

	describe('goal mutations', () => {
		test('record preserves idempotency fields across retries and ignores spoofed actor', async () => {
			for (const requestId of ['request-1', 'request-2']) {
				const input = args({ ...recordFields, ...spoofed, requestId });
				const result = await detail.action(input);
				checkData(result);
				expect(result.data).toMatchObject({
					ok: true,
					intent: 'record',
					requestId,
					recordedCents: 3000,
				});
				expect(auth).toHaveBeenCalledWith(input);
			}
			expect(goalStore.mock.calls).toEqual([[userId], [userId]]);
			expect(store.record.mock.calls).toEqual(
				Array(2).fill([
					goalId,
					{
						cellIndexes: [0, 2],
						expectedGridRevision: 3,
						submissionId: 'stable-submission',
					},
				]),
			);
			expect(getUser).not.toHaveBeenCalled();
		});
		const mutations = [
			{
				intent: 'undo',
				fields: { contributionId: 'contribution_1' },
				method: 'undo',
				forwarded: [goalId, 'contribution_1'],
			},
			{
				intent: 'edit',
				fields: { ...configFields(), expectedGridRevision: '3' },
				method: 'edit',
				forwarded: [goalId, config, 3],
			},
			{
				intent: 'createInvite',
				fields: {},
				method: 'createInvite',
				forwarded: [goalId],
			},
			{
				intent: 'removeMember',
				fields: { memberUserId: 'member_to_remove' },
				method: 'removeMember',
				forwarded: [goalId, 'member_to_remove'],
			},
			{
				intent: 'revokeInvite',
				fields: { inviteId: 'invite_to_revoke' },
				method: 'revokeInvite',
				forwarded: [goalId, 'invite_to_revoke'],
			},
			{
				intent: 'archive',
				fields: {},
				method: 'setArchived',
				forwarded: [goalId, true],
			},
			{
				intent: 'unarchive',
				fields: {},
				method: 'setArchived',
				forwarded: [goalId, false],
			},
		] as const;
		for (const entry of mutations) {
			test(`${entry.intent} forwards only intended fields with the authenticated actor`, async () => {
				const input = args({
					...entry.fields,
					...spoofed,
					intent: entry.intent,
					requestId: 'request-1',
				});
				const result = await detail.action(input);
				checkData(result);
				expect(auth).toHaveBeenCalledWith(input);
				expect(goalStore.mock.calls).toEqual([[userId]]);
				expect(store[entry.method].mock.calls).toEqual([entry.forwarded]);
				expect(result.data).toMatchObject({
					ok: true,
					intent: entry.intent,
					requestId: 'request-1',
				});
				if (entry.intent === 'createInvite')
					expect(result.data).toMatchObject({
						invite: { token, inviteId: 'invite_created' },
					});
				expect(getUser).not.toHaveBeenCalled();
			});
		}
		const invalidInputs: [string, Record<string, string | string[]>][] = [
			['missing intent', { intent: [] }],
			['unknown intent', { intent: 'destroy' }],
			['duplicate intent', { intent: ['record', 'archive'] }],
			['missing request ID', { requestId: [] }],
			['blank request ID', { requestId: ' ' }],
			['oversized request ID', { requestId: 'x'.repeat(129) }],
			['duplicate request ID', { requestId: ['one', 'two'] }],
			['missing submission ID', { submissionId: [] }],
			['duplicate submission ID', { submissionId: ['one', 'two'] }],
			['no cells', { cellIndexes: [] }],
			['duplicate cells', { cellIndexes: ['0', '0'] }],
			['numeric duplicate cells', { cellIndexes: ['0', '00'] }],
			['negative cell', { cellIndexes: ['-1'] }],
			['fractional cell', { cellIndexes: ['1.5'] }],
			['unsafe cell', { cellIndexes: ['9007199254740992'] }],
			[
				'too many cells',
				{ cellIndexes: Array.from({ length: 501 }, (_, i) => String(i)) },
			],
			['zero revision', { expectedGridRevision: '0' }],
			['exponent revision', { expectedGridRevision: '1e2' }],
			['unsafe revision', { expectedGridRevision: '9007199254740992' }],
			['duplicate revision', { expectedGridRevision: ['1', '2'] }],
			['missing contribution', { intent: 'undo' }],
			['missing member', { intent: 'removeMember' }],
			['missing invite', { intent: 'revokeInvite' }],
			['missing edit config', { intent: 'edit' }],
		];
		for (const [label, fields] of invalidInputs) {
			test(`rejects ${label} without mutations`, async () => {
				const result = await detail.action(
					args({ ...recordFields, ...fields }),
				);
				checkData(result, 400);
				expect(result.data).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
				noMutations();
			});
		}
		test('rejects non-POST mutations', async () => {
			checkData(
				await detail.action(args(recordFields, { method: 'PUT' })),
				400,
			);
			noMutations();
		});
		test('forbidden mutation throws to clear stale detail', async () => {
			store.record.mockRejectedValueOnce(failure('FORBIDDEN'));
			const result = await thrown(() => detail.action(args(recordFields)));
			checkData(result, 403);
			expect(result.data).toBe('Safe domain error');
		});
		for (const code of [
			'CONFLICT',
			'GRID_CHANGED',
			'ARCHIVED',
			'LOCKED',
			'INVITE_LIMIT',
		]) {
			test(`${code} returns correlation fields and forces conflict revalidation`, async () => {
				store.record.mockRejectedValueOnce(failure(code));
				const result = await detail.action(args(recordFields));
				checkData(result, 409);
				expect(result.data).toEqual({
					ok: false,
					code,
					message: 'Safe domain error',
					intent: 'record',
					requestId: 'request-1',
				});
				expect(
					detail.shouldRevalidate({
						actionStatus: result.init?.status,
						defaultShouldRevalidate: false,
					} as never),
				).toBe(true);
			});
		}
		for (const actionStatus of [undefined, 200, 400, 403, 503]) {
			test(`preserves router revalidation default for status ${actionStatus}`, () => {
				for (const defaultShouldRevalidate of [false, true]) {
					expect(
						detail.shouldRevalidate({
							actionStatus,
							defaultShouldRevalidate,
						} as never),
					).toBe(defaultShouldRevalidate);
				}
			});
		}
		test('unexpected mutation failures never disclose secrets', async () => {
			store.record.mockRejectedValueOnce(new Error(token));
			const result = await detail.action(args(recordFields));
			checkData(result, 503);
			expect(result.data).toMatchObject({
				ok: false,
				code: 'UNAVAILABLE',
				message: goalError(null).message,
			});
			expect(JSON.stringify(result.data)).not.toContain(token);
		});
	});

	describe('invite inspection and explicit acceptance', () => {
		test('unavailable acceptance revalidates stale invitation details', () => {
			expect(
				invite.shouldRevalidate({
					actionStatus: 410,
					defaultShouldRevalidate: false,
				} as never),
			).toBe(true);
		});
		test('malformed acceptance body returns a private validation response', async () => {
			const input = args();
			input.request = new Request(`http://localhost/invites/${token}`, {
				method: 'POST',
				body: 'not a form',
				headers: { 'Content-Type': 'application/json' },
			});
			checkData((await invite.action(input as never)) as DataResult, 400);
			noMutations();
		});
		test('GET inspects the path token but never accepts, even with an accept query', async () => {
			const input = args(undefined, {
				path: `/invites/${token}?intent=accept&userId=attacker`,
			});
			const result = await invite.loader(input as never);
			checkData(result);
			expect(auth).toHaveBeenCalledWith(input);
			expect(goalStore.mock.calls).toEqual([[userId]]);
			expect(store.inspectInvite.mock.calls).toEqual([[token]]);
			expect(getUser.mock.calls).toEqual([[userId]]);
			expect(result.data).toEqual({
				invite: { goalName: config.name, eligible: true },
				displayName,
			});
			noMutations();
		});
		for (const unavailable of ['null', 'error']) {
			test(`unavailable invite via ${unavailable} does not load a profile or accept`, async () => {
				if (unavailable === 'null')
					store.inspectInvite.mockResolvedValueOnce(null);
				else
					store.inspectInvite.mockRejectedValueOnce(
						failure('INVITE_UNAVAILABLE'),
					);
				const result = await invite.loader(args() as never);
				checkData(result);
				expect(result.data).toEqual({ invite: null, displayName: null });
				expect(getUser).not.toHaveBeenCalled();
				noMutations();
			});
		}
		test('inspection failure throws a safe response', async () => {
			store.inspectInvite.mockRejectedValueOnce(new Error(token));
			const result = await thrown(() => invite.loader(args() as never));
			checkData(result, 503);
			expect(result.data).toEqual({ message: goalError(null).message });
			noMutations();
		});
		test('explicit POST accepts the path token with authenticated profile, not form identity', async () => {
			const input = args({ intent: 'accept', ...spoofed });
			checkRedirect(await invite.action(input as never));
			expect(auth).toHaveBeenCalledWith(input);
			expect(goalStore.mock.calls).toEqual([[userId]]);
			expect(getUser.mock.calls).toEqual([[userId]]);
			expect(store.acceptInvite.mock.calls).toEqual([[token, displayName]]);
			expect(store.inspectInvite).not.toHaveBeenCalled();
		});
		for (const intent of [undefined, '', 'inspect', 'Accept']) {
			test(`POST intent ${String(intent)} cannot accept`, async () => {
				checkData(
					(await invite.action(
						args(intent === undefined ? {} : { intent }) as never,
					)) as DataResult,
					400,
				);
				noMutations();
				expect(getUser).not.toHaveBeenCalled();
			});
		}
		for (const method of ['GET', 'HEAD', 'PUT', 'DELETE']) {
			test(`${method} cannot accept even with explicit intent`, async () => {
				checkData(
					(await invite.action(
						args({ intent: 'accept' }, { method }) as never,
					)) as DataResult,
					405,
				);
				noMutations();
			});
		}
		for (const [code, status] of [
			['INVITE_UNAVAILABLE', 410],
			['FORBIDDEN', 403],
			['CONFLICT', 409],
		] as const) {
			test(`acceptance ${code} preserves status and privacy headers`, async () => {
				store.acceptInvite.mockRejectedValueOnce(failure(code));
				const result = (await invite.action(
					args({ intent: 'accept' }) as never,
				)) as DataResult;
				checkData(result, status);
				expect(result.data).toEqual({ error: 'Safe domain error' });
			});
		}
	});

	describe('real adapter parser and safe errors', () => {
		test('parser returns only normalized config, ignoring spoofed fields', () => {
			const form = new FormData();
			for (const [key, value] of Object.entries({
				...configFields(),
				...spoofed,
				name: '  Rainy day  ',
			}))
				form.set(key, value);
			expect(readGoalConfig(form)).toEqual(config);
		});
		test('parser rejects file-valued fields', () => {
			const form = new FormData();
			for (const [key, value] of Object.entries(configFields()))
				form.set(key, value);
			form.set('name', new Blob(['spoof']), 'name.txt');
			expect(() => readGoalConfig(form)).toThrow(ConvexError);
		});
		for (const [code, status] of Object.entries({
			INVALID_INPUT: 400,
			FORBIDDEN: 403,
			CONFLICT: 409,
			GRID_CHANGED: 409,
			ARCHIVED: 409,
			LOCKED: 409,
			INVITE_UNAVAILABLE: 410,
			INVITE_LIMIT: 409,
		})) {
			test(`maps ${code} to ${status}`, () => {
				expect(goalError(failure(code))).toEqual({
					code,
					status,
					message: 'Safe domain error',
				});
			});
		}
		for (const error of [
			new Error(token),
			token,
			null,
			{ data: { code: 'FORBIDDEN', message: token } },
			new ConvexError({ code: 'UNKNOWN', message: token }),
			new ConvexError({ code: 'constructor', message: token }),
			new ConvexError({ code: 'FORBIDDEN', message: 123 }),
		]) {
			test(`redacts untrusted error ${error === null ? 'null' : typeof error}`, () => {
				expect(goalError(error)).toEqual({
					code: 'UNAVAILABLE',
					status: 503,
					message: 'Savings are temporarily unavailable. Please try again.',
				});
			});
		}
		test('profile display name uses the primary email when no name or username is available', async () => {
			getUser.mockResolvedValueOnce({
				firstName: '',
				lastName: '',
				username: null,
				primaryEmailAddressId: 'primary',
				emailAddresses: [
					{ id: 'secondary', emailAddress: 'other@example.com' },
					{ id: 'primary', emailAddress: 'member@example.com' },
				],
			});
			expect(await getGoalDisplayName(userId, args())).toBe(
				'member@example.com',
			);
			expect(getUser.mock.calls).toEqual([[userId]]);
		});
		test('profile display names are limited to 80 characters', async () => {
			getUser.mockResolvedValueOnce({
				firstName: 'x'.repeat(100),
				lastName: '',
				username: null,
				primaryEmailAddressId: null,
				emailAddresses: [],
			});
			expect(await getGoalDisplayName(userId, args())).toBe('x'.repeat(80));
		});
	});
}
