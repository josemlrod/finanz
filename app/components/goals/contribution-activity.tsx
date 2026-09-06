import { useEffect, useRef, useState } from 'react';
import { useFetcher } from 'react-router';
import type { GoalDetail, loader } from '~/routes/goal-detail';
import type { goalStore } from '~/lib/goals/convex-goal-store.server';
import { Avatar, formatCents, formatDate } from './shared';

type ActivityPage = Awaited<
	ReturnType<ReturnType<typeof goalStore>['activity']>
>;

export function ContributionActivity({
	detail,
	snapshotAt,
	firstPage,
	busy,
	onUndo,
}: {
	detail: GoalDetail;
	snapshotAt: string;
	firstPage: ActivityPage;
	busy: boolean;
	onUndo: (id: string) => void;
}) {
	const [older, setOlder] = useState<ActivityPage['page']>([]);
	const [pagination, setPagination] = useState<{
		cursor: string;
		done: boolean;
	} | null>(null);
	const [loadingCursor, setLoadingCursor] = useState<string | null>(null);
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
	const previousHead = useRef<Set<string>>(new Set());
	useEffect(() => {
		if (
			previousHead.current.size &&
			!firstPage.page.some((event) => previousHead.current.has(event._id))
		) {
			// More than a full page arrived between reads. Backfill from the new head to avoid a history gap.
			setPagination(null);
		}
		previousHead.current = new Set(firstPage.page.map((event) => event._id));
		setOlder((previous) => [
			...new Map(
				[...previous, ...firstPage.page].map((event) => [event._id, event]),
			).values(),
		]);
	}, [firstPage]);
	const events = [
		...new Map(
			[...older, ...firstPage.page].map((event) => [event._id, event]),
		).values(),
	].sort(
		(a, b) =>
			b.at.localeCompare(a.at) ||
			b._creationTime - a._creationTime ||
			b._id.localeCompare(a._id),
	);
	const activeIds = new Set(detail.contributions.map((row) => row._id));
	const name = (id: string) => {
		const member = detail.members.find((row) => row.userId === id);
		return member
			? `${member.displayName}${member.removedAt !== null ? ' (former member)' : ''}`
			: 'Goal member';
	};
	const done = pagination?.done ?? firstPage.isDone;
	const cursor = pagination?.cursor ?? firstPage.continueCursor;

	return (
		<section className='rounded-3xl border border-white/10 bg-[#101014] px-5 py-4'>
			<h2 className='text-xs font-medium uppercase tracking-[0.14em] text-zinc-400'>
				Activity
			</h2>
			{!events.length && (
				<p className='py-5 text-sm text-zinc-400'>
					No recorded savings yet. Your first completed cell will appear here.
				</p>
			)}
			<ol className='mt-2 divide-y divide-white/[0.06]'>
				{events.map((event) => {
					const member = detail.members.find(
						(row) => row.userId === event.actorId,
					);
					const open = expanded.has(event._id);
					const amount = event.contributions.reduce(
						(sum, row) => sum + row.amountCents,
						0,
					);
					return (
						<li key={event._id} className='py-3'>
							<div className='flex items-start gap-3'>
								<Avatar
									colorIndex={member?.colorIndex ?? 0}
									displayName={member?.displayName ?? 'Goal member'}
								/>
								<div className='min-w-0 flex-1'>
									{event.kind === 'recorded' ? (
										<button
											type='button'
											aria-expanded={open}
											onClick={() =>
												setExpanded((previous) => {
													const next = new Set(previous);
													if (next.has(event._id)) next.delete(event._id);
													else next.add(event._id);
													return next;
												})
											}
											className='min-h-11 w-full rounded-md text-left text-sm leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-indigo-400'
										>
											{name(event.actorId)} recorded{' '}
											<span className='tabular-nums text-zinc-100'>
												{formatCents(amount)}
											</span>{' '}
											across {event.contributions.length}{' '}
											{event.contributions.length === 1 ? 'cell' : 'cells'}.{' '}
											<span className='text-xs text-indigo-300'>
												{open ? 'Hide cells' : 'View cells'}
											</span>
										</button>
									) : (
										<p className='text-sm leading-relaxed'>
											{name(event.actorId)} undid {formatCents(amount)} recorded
											by {name(event.contributions[0]?.contributorId ?? '')}.
										</p>
									)}
									<time
										dateTime={event.at}
										className='block text-xs text-zinc-500'
									>
										{formatDate(event.at)}, {event.at.slice(11, 16)} UTC
									</time>
								</div>
							</div>
							{event.kind === 'recorded' && open && (
								<ul className='mt-3 space-y-2 border-l border-white/10 pl-3'>
									{event.contributions.map((row) => {
										// A history read can include a recording made after the detail snapshot began.
										// Do not mislabel that confirmed recording as undone until a newer snapshot arrives.
										const active =
											row.undoneAt === null && activeIds.has(row._id);
										const awaitingRefresh =
											!active &&
											row.undoneAt === null &&
											row.recordedAt >= snapshotAt;
										return (
											<li
												key={row._id}
												className='flex flex-wrap items-center justify-between gap-2 text-xs'
											>
												<span>
													Cell {row.cellIndex + 1}:{' '}
													<span className='tabular-nums'>
														{formatCents(row.amountCents)}
													</span>{' '}
													<span
														className={
															active ? 'text-emerald-300' : 'text-zinc-500'
														}
													>
														{active
															? 'Recorded'
															: awaitingRefresh
																? 'Recorded; refreshing cell state'
																: 'Undone'}
													</span>
													{!active && row.undoneAt && (
														<span className='block text-zinc-500'>
															By {name(row.undoneBy ?? '')} on{' '}
															{formatDate(row.undoneAt)} UTC
														</span>
													)}
												</span>
												{active &&
													detail.goal.archivedAt === null &&
													(detail.viewer.isOwner ||
														row.contributorId === detail.viewer.userId) && (
														<button
															type='button'
															disabled={busy}
															onClick={() => {
																if (
																	window.confirm(
																		`Undo ${formatCents(row.amountCents)} from cell ${row.cellIndex + 1}? History will be preserved.`,
																	)
																)
																	onUndo(row._id);
															}}
															className='min-h-11 rounded-lg px-3 text-rose-300 hover:bg-rose-400/10 disabled:opacity-50'
														>
															Undo
														</button>
													)}
											</li>
										);
									})}
								</ul>
							)}
						</li>
					);
				})}
			</ol>
			{!done && (
				<button
					type='button'
					disabled={busy || loadingCursor !== null}
					onClick={() => setLoadingCursor(cursor)}
					className='mt-3 min-h-11 w-full rounded-xl border border-white/10 text-sm text-zinc-300 hover:bg-white/5 disabled:opacity-50'
				>
					{loadingCursor !== null
						? 'Loading activity...'
						: 'Load older activity'}
				</button>
			)}
			{loadingCursor !== null && (
				<HistoryPage
					goalId={detail.goal._id}
					cursor={loadingCursor}
					onPage={(page) => {
						setOlder((previous) => [
							...new Map(
								[...previous, ...page.page].map((event) => [event._id, event]),
							).values(),
						]);
						setPagination({ cursor: page.continueCursor, done: page.isDone });
						setLoadingCursor(null);
					}}
				/>
			)}
		</section>
	);
}

// Unmount each completed page fetcher rather than retaining a subscription to an
// older history cursor. The first page is supplied by the live Convex query.
function HistoryPage({
	goalId,
	cursor,
	onPage,
}: {
	goalId: string;
	cursor: string;
	onPage: (page: ActivityPage) => void;
}) {
	const history = useFetcher<typeof loader>();
	const path = `/goals/${goalId}?${new URLSearchParams({ activityCursor: cursor })}`;
	useEffect(() => {
		void history.load(path);
	}, [history.load, path]);
	useEffect(() => {
		if (history.state === 'idle' && history.data) onPage(history.data.activity);
	}, [history.state, history.data, onPage]);
	return null;
}
