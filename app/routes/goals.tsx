import { Plus } from 'lucide-react';
import { useState } from 'react';
import { data, Link, redirect, useFetcher } from 'react-router';
import type { Route } from './+types/goals';
import { GoalForm } from '~/components/goals/goal-form';
import {
	DISCLAIMER,
	formatCents,
	formatDate,
	GoalHeader,
	panelClass,
	primaryButtonClass,
	Sheet,
} from '~/components/goals/shared';
import { requirePageAuth } from '~/lib/auth.server';
import {
	getGoalDisplayName,
	goalError,
	goalStore,
	readGoalConfig,
	savingsHeaders,
} from '~/lib/goals/convex-goal-store.server';
import { calculateProgress } from '~/lib/goals/progress';
import { todayUtc, validateGoalConfig } from '../../convex/lib/goals';

export const headers: Route.HeadersFunction = () => savingsHeaders;

export async function loader(args: Route.LoaderArgs) {
	const { userId } = await requirePageAuth(args);
	const params = new URL(args.request.url).searchParams;
	const archived = params.get('view') === 'archived';
	const cursor = params.get('cursor') ?? undefined;
	if (cursor !== undefined && (!cursor || cursor.length > 8192)) {
		throw data('Invalid goals cursor.', {
			status: 400,
			headers: savingsHeaders,
		});
	}
	try {
		const result = await goalStore(userId).list({ cursor, archived });
		const today = todayUtc();
		return data(
			{
				goals: result.page.map((goal) => ({
					...goal,
					progress: calculateProgress({ ...goal, today }),
				})),
				archived,
				cursor,
				continueCursor: result.continueCursor,
				isDone: result.isDone,
			},
			{ headers: savingsHeaders },
		);
	} catch (error) {
		const safe = goalError(error);
		throw data(
			{ message: safe.message },
			{ status: safe.status, headers: savingsHeaders },
		);
	}
}

export async function action(args: Route.ActionArgs) {
	const { userId } = await requirePageAuth(args);
	if (args.request.method !== 'POST')
		return data(
			{ error: 'Use POST to create a goal.' },
			{ status: 405, headers: savingsHeaders },
		);
	try {
		const config = validateGoalConfig(
			readGoalConfig(await args.request.formData()),
		);
		const displayName = await getGoalDisplayName(userId, args);
		const goalId = await goalStore(userId).create(config, displayName);
		return redirect(`/goals/${goalId}`, { headers: savingsHeaders });
	} catch (error) {
		const safe = goalError(error);
		return data(
			{ error: safe.message },
			{ status: safe.status, headers: savingsHeaders },
		);
	}
}

export default function Goals({ loaderData }: Route.ComponentProps) {
	const [creating, setCreating] = useState(false);
	const fetcher = useFetcher<typeof action>();
	const pending = fetcher.state !== 'idle';
	const goals = loaderData.goals;
	const filteredPage = !!loaderData.cursor || !loaderData.isDone;
	const firstPage = loaderData.archived ? '/goals?view=archived' : '/goals';
	const nextParams = new URLSearchParams({
		...(loaderData.archived ? { view: 'archived' } : {}),
		cursor: loaderData.continueCursor,
	});
	return (
		<main className='min-h-screen bg-[#0b0b0e] px-4 pb-16 text-zinc-100 selection:bg-indigo-400/30 sm:px-7'>
			<div className='mx-auto max-w-6xl'>
				<GoalHeader backTo='/' backLabel='Dashboard'>
					<button
						type='button'
						onClick={() => setCreating(true)}
						className={primaryButtonClass}
					>
						<Plus aria-hidden='true' className='size-4' />
						New goal
					</button>
				</GoalHeader>
				<div className='mb-7 mt-5 flex flex-wrap items-end justify-between gap-5'>
					<div>
						<h1 className='font-heading text-3xl font-semibold tracking-tight sm:text-4xl'>
							Savings goals
						</h1>
						<p className='mt-2 text-sm text-zinc-400'>
							A little set aside. One cell at a time.
						</p>
					</div>
					<nav
						aria-label='Filter goals'
						className='flex gap-1 rounded-2xl border border-white/10 bg-[#101014] p-1'
					>
						{[
							{ archived: false, label: 'Active', to: '/goals' },
							{ archived: true, label: 'Archived', to: '/goals?view=archived' },
						].map((filter) => (
							<Link
								key={filter.label}
								to={filter.to}
								aria-current={
									loaderData.archived === filter.archived ? 'page' : undefined
								}
								className={`flex min-h-11 items-center rounded-xl px-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${loaderData.archived === filter.archived ? 'bg-indigo-400/15 text-indigo-200' : 'text-zinc-400 hover:text-zinc-100'}`}
							>
								{filter.label}
							</Link>
						))}
					</nav>
				</div>
				{goals.length ? (
					<ul className='grid gap-4 md:grid-cols-2 lg:grid-cols-3'>
						{goals.map((goal) => (
							<li key={goal._id}>
								<Link
									to={`/goals/${goal._id}`}
									className={`${panelClass} block h-full p-6 outline-none transition-colors duration-200 ease-out hover:border-indigo-400/40 focus-visible:ring-2 focus-visible:ring-indigo-400 motion-reduce:transition-none`}
								>
									<div className='flex items-start justify-between gap-3'>
										<div className='min-w-0'>
											<p className='text-xs text-zinc-500'>
												{goal.isOwner ? 'Owner' : 'Shared with you'}
											</p>
											<h2 className='mt-2 break-words font-heading text-xl font-semibold tracking-tight'>
												{goal.name}
											</h2>
										</div>
										<div
											className='relative size-16 shrink-0'
											aria-label={`${goal.progress.percent.toFixed(0)}% recorded`}
											role='img'
										>
											<svg
												aria-hidden='true'
												viewBox='0 0 64 64'
												className='size-16 -rotate-90'
											>
												<circle
													cx='32'
													cy='32'
													r='27'
													fill='none'
													stroke='rgba(255,255,255,0.06)'
													strokeWidth='5'
												/>
												<circle
													cx='32'
													cy='32'
													r='27'
													fill='none'
													stroke='#818cf8'
													strokeWidth='5'
													pathLength='100'
													strokeDasharray={`${goal.progress.percent} 100`}
												/>
											</svg>
											<span
												aria-hidden='true'
												className='absolute inset-0 flex items-center justify-center font-heading text-sm font-semibold tabular-nums'
											>
												{goal.progress.percent.toFixed(0)}%
											</span>
										</div>
									</div>
									<p className='mt-6 font-heading text-2xl font-semibold tabular-nums'>
										{formatCents(goal.recordedCents)}{' '}
										<span className='font-sans text-xs font-normal text-zinc-500'>
											recorded
										</span>
									</p>
									<p className='mt-1 text-sm tabular-nums text-zinc-400'>
										{formatCents(goal.progress.remainingCents)} remaining of{' '}
										{formatCents(goal.targetCents)}
									</p>
									<div className='mt-5 flex flex-wrap justify-between gap-2 border-t border-white/[0.06] pt-4 text-xs text-zinc-500'>
										<span>Target {formatDate(goal.targetDate)}</span>
										<span
											className={
												goal.progress.status === 'overdue'
													? 'text-amber-300'
													: 'text-indigo-300'
											}
										>
											{loaderData.archived
												? 'Archived'
												: goal.progress.status === 'completed'
													? 'Completed'
													: goal.progress.status === 'overdue'
														? 'Overdue'
														: goal.progress.status === 'upcoming'
															? 'Upcoming'
															: 'In progress'}
										</span>
									</div>
								</Link>
							</li>
						))}
					</ul>
				) : (
					<section className={`${panelClass} px-6 py-16 text-center`}>
						<div
							aria-hidden='true'
							className='mx-auto mb-6 grid w-32 grid-cols-3 gap-2'
						>
							{Array.from({ length: 9 }, (_, index) => (
								<span
									key={index}
									className={`aspect-square rounded-xl border ${index < 3 ? 'border-indigo-400/25 bg-indigo-400/15' : 'border-white/[0.08] bg-white/[0.03]'}`}
								/>
							))}
						</div>
						<h2 className='font-heading text-xl font-semibold'>
							{filteredPage
								? `No ${loaderData.archived ? 'archived' : 'active'} goals on this page`
								: loaderData.archived
									? 'No archived goals'
									: 'Start with something worth saving for'}
						</h2>
						<p className='mx-auto mt-2 max-w-sm text-sm leading-relaxed text-zinc-400'>
							{filteredPage
								? !loaderData.isDone
									? 'Load the next page to keep looking in this view.'
									: 'You have reached the last page. Return to the first page or switch views.'
								: loaderData.archived
									? 'Goals you archive will stay here with their recorded savings and history.'
									: 'Turn your target into small, whole-dollar steps. No linked Item needed.'}
						</p>
						{!loaderData.archived && !filteredPage ? (
							<button
								type='button'
								onClick={() => setCreating(true)}
								className={`${primaryButtonClass} mt-6`}
							>
								Create your first goal
							</button>
						) : null}
					</section>
				)}
				{filteredPage ? (
					<nav aria-label='Goal pages' className='mt-6 flex flex-wrap gap-3'>
						{loaderData.cursor ? (
							<Link to={firstPage} className={primaryButtonClass}>
								Back to first page
							</Link>
						) : null}
						{!loaderData.isDone ? (
							<Link to={`/goals?${nextParams}`} className={primaryButtonClass}>
								Load next page
							</Link>
						) : null}
					</nav>
				) : null}
				<p className='mt-7 max-w-2xl text-xs leading-relaxed text-zinc-500'>
					{DISCLAIMER} Dates use UTC.
				</p>
			</div>
			<Sheet
				open={creating}
				onOpenChange={(open) => {
					if (!pending) setCreating(open);
				}}
				title='Create a savings goal'
			>
				{fetcher.data?.error ? (
					<p
						role='alert'
						className='mt-3 rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-sm text-amber-200'
					>
						{fetcher.data.error}
					</p>
				) : null}
				<GoalForm
					pending={pending}
					onSubmit={(config) => {
						const form = new FormData();
						for (const [key, value] of Object.entries(config))
							form.set(key, String(value));
						void fetcher.submit(form, { method: 'post', action: '/goals' });
					}}
				/>
			</Sheet>
		</main>
	);
}

export function ErrorBoundary(_: Route.ErrorBoundaryProps) {
	return (
		<main className='min-h-screen bg-[#0b0b0e] px-4 text-zinc-100 sm:px-7'>
			<div className='mx-auto max-w-6xl'>
				<GoalHeader backTo='/' backLabel='Dashboard' />
				<section className={`${panelClass} p-8`}>
					<h1 className='font-heading text-2xl font-semibold'>
						Savings goals are unavailable
					</h1>
					<p className='mt-3 text-sm text-zinc-400'>
						We could not load your goals. Try again in a moment.
					</p>
					<Link
						to='/goals'
						reloadDocument
						className={`${primaryButtonClass} mt-5`}
					>
						Try again
					</Link>
				</section>
			</div>
		</main>
	);
}
