import {
	data,
	Form,
	Link,
	redirect,
	useNavigation,
	type ShouldRevalidateFunctionArgs,
} from 'react-router';
import type { Route } from './+types/goal-invite';
import {
	GoalHeader,
	panelClass,
	primaryButtonClass,
} from '~/components/goals/shared';
import { requirePageAuth } from '~/lib/auth.server';
import {
	getGoalDisplayName,
	goalError,
	goalStore,
	savingsHeaders,
} from '~/lib/goals/convex-goal-store.server';

export const headers: Route.HeadersFunction = () => savingsHeaders;
export const meta: Route.MetaFunction = () => [
	{ title: 'Savings invitation - Finanz' },
	{ name: 'referrer', content: 'no-referrer' },
];

export function shouldRevalidate({
	actionStatus,
	defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
	return (
		actionStatus === 410 || actionStatus === 403 || defaultShouldRevalidate
	);
}

export async function loader(args: Route.LoaderArgs) {
	const { userId } = await requirePageAuth(args);
	try {
		const invite = await goalStore(userId).inspectInvite(args.params.token);
		const displayName = invite ? await getGoalDisplayName(userId, args) : null;
		return data({ invite, displayName }, { headers: savingsHeaders });
	} catch (error) {
		const safe = goalError(error);
		if (safe.code === 'INVITE_UNAVAILABLE')
			return data(
				{ invite: null, displayName: null },
				{ headers: savingsHeaders },
			);
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
			{ error: 'Use POST to accept an invitation.' },
			{ status: 405, headers: savingsHeaders },
		);
	let form: FormData;
	try {
		form = await args.request.formData();
	} catch {
		return data(
			{ error: 'Submit the invitation acceptance form.' },
			{ status: 400, headers: savingsHeaders },
		);
	}
	if (form.get('intent') !== 'accept' || form.getAll('intent').length !== 1)
		return data(
			{ error: 'Confirm acceptance to join this goal.' },
			{ status: 400, headers: savingsHeaders },
		);
	try {
		const displayName = await getGoalDisplayName(userId, args);
		const goalId = await goalStore(userId).acceptInvite(
			args.params.token,
			displayName,
		);
		return redirect(`/goals/${goalId}`, { headers: savingsHeaders });
	} catch (error) {
		const safe = goalError(error);
		return data(
			{ error: safe.message },
			{ status: safe.status, headers: savingsHeaders },
		);
	}
}

export default function GoalInvite({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const pending = useNavigation().state !== 'idle';
	const { invite, displayName } = loaderData;
	return (
		<main className='min-h-screen bg-[#0b0b0e] px-4 pb-12 text-zinc-100 sm:px-7'>
			<div className='mx-auto max-w-3xl'>
				<GoalHeader />
				<section className={`${panelClass} mx-auto mt-8 max-w-lg p-6 sm:p-8`}>
					<p className='text-xs uppercase tracking-wider text-indigo-300'>
						Savings invitation
					</p>
					<h1 className='mt-3 break-words font-heading text-3xl font-semibold tracking-tight'>
						{invite ? invite.goalName : 'This link is unavailable'}
					</h1>
					{invite ? (
						<>
							<p className='mt-4 text-sm leading-relaxed text-zinc-400'>
								Signed in as{' '}
								<span className='text-zinc-100'>{displayName}</span>. Joining
								gives you access to this goal's amounts, dates, and Contribution
								history. Your name, or your email when no name is available, and
								recorded savings will be visible to its members.
							</p>
							<p className='mt-3 text-sm leading-relaxed text-zinc-500'>
								Finanz does not move money or verify balances. Your banking data
								is never shared with Goal Members.
							</p>
							{invite.eligible ? (
								<Form method='post' className='mt-6'>
									<input type='hidden' name='intent' value='accept' />
									<button
										type='submit'
										disabled={pending}
										className={`${primaryButtonClass} w-full`}
									>
										{pending ? 'Joining...' : 'Accept invitation'}
									</button>
								</Form>
							) : (
								<p className='mt-6 rounded-2xl border border-indigo-400/20 bg-indigo-400/10 p-4 text-sm text-indigo-200'>
									You already have access. This invitation remains available for
									someone else.
								</p>
							)}
						</>
					) : (
						<p className='mt-4 text-sm leading-relaxed text-zinc-400'>
							This invitation may have expired, been revoked, or already been
							accepted. Ask the owner for a new link.
						</p>
					)}
					{actionData?.error ? (
						<p role='alert' className='mt-4 text-sm text-amber-200'>
							{actionData.error}
						</p>
					) : null}
					<Link
						to='/goals'
						className='mt-6 inline-flex min-h-11 items-center text-sm text-zinc-400 hover:text-white'
					>
						Back to savings goals
					</Link>
				</section>
			</div>
		</main>
	);
}

export function ErrorBoundary(_: Route.ErrorBoundaryProps) {
	return (
		<main className='min-h-screen bg-[#0b0b0e] px-4 text-zinc-100'>
			<div className='mx-auto max-w-3xl'>
				<GoalHeader />
				<section className={`${panelClass} p-8`}>
					<h1 className='font-heading text-2xl font-semibold'>
						Invitation unavailable
					</h1>
					<p className='mt-3 text-sm text-zinc-400'>
						We could not load this invitation. Try again later or ask the owner
						for a new link.
					</p>
					<Link to='/goals' className={`${primaryButtonClass} mt-5`}>
						Savings goals
					</Link>
				</section>
			</div>
		</main>
	);
}
