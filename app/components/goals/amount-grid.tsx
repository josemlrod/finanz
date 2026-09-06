import { Check, ChevronUp, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { GoalDetail } from '~/routes/goal-detail';
import { cn } from '~/lib/utils';
import {
	Avatar,
	DISCLAIMER,
	formatCents,
	formatDate,
	memberTone,
	primaryButtonClass,
	Sheet,
} from './shared';

export function AmountGrid({
	detail,
	selected,
	warning,
	pending,
	recordedRequestId,
	onToggle,
	onRecord,
	onUndo,
}: {
	detail: GoalDetail;
	selected: ReadonlySet<number>;
	warning: string | null;
	pending: boolean;
	recordedRequestId: string | null;
	onToggle: (index: number) => void;
	onRecord: () => void;
	onUndo: (id: string) => void;
}) {
	const [confirming, setConfirming] = useState(false);
	const [inspecting, setInspecting] = useState<string | null>(null);
	useEffect(() => {
		if (recordedRequestId) setConfirming(false);
	}, [recordedRequestId]);
	const { goal, contributions, members, viewer } = detail;
	const archived = goal.archivedAt !== null;
	const active = new Map(contributions.map((row) => [row.cellIndex, row]));
	const inspected = contributions.find((row) => row._id === inspecting);
	const contributor = members.find(
		(member) => member.userId === inspected?.contributorId,
	);
	const total = [...selected].reduce(
		(sum, index) => sum + goal.cellAmountsCents[index],
		0,
	);

	return (
		<>
			<div className='flex items-baseline justify-between gap-3 px-1'>
				<h2 className='font-heading text-lg font-medium tracking-tight'>
					{archived ? 'Savings cells' : 'Choose cells to record'}
				</h2>
				<p className='text-xs tabular-nums text-zinc-400'>
					{goal.cellAmountsCents.length - contributions.length} unpaid
				</p>
			</div>
			<p className='mt-2 px-1 text-xs text-zinc-400'>
				{archived
					? 'Archived. Completed cells and their attribution are still available.'
					: 'Select any unpaid cells. Selection does not reserve them or record savings.'}
			</p>
			{warning && (
				<p
					role='alert'
					className='mt-4 rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-sm text-amber-200'
				>
					{warning}
				</p>
			)}
			<div
				role='group'
				aria-label='Savings cells'
				className='mt-4 grid grid-cols-4 gap-2.5 sm:grid-cols-6 md:grid-cols-7 lg:grid-cols-6 xl:grid-cols-8'
			>
				{goal.cellAmountsCents.map((amount, index) => {
					const contribution = active.get(index);
					const member = members.find(
						(row) => row.userId === contribution?.contributorId,
					);
					const name = member
						? `${member.displayName}${member.removedAt !== null ? ', former member' : ''}`
						: 'Goal member';
					const isSelected = selected.has(index);
					return (
						<button
							key={`${goal.gridRevision}:${index}`}
							type='button'
							disabled={!contribution && (archived || pending)}
							aria-pressed={contribution ? undefined : isSelected}
							aria-label={`Cell ${index + 1}, ${formatCents(amount)}, ${contribution ? `recorded by ${name} on ${formatDate(contribution.recordedAt)}. View details` : `unpaid${isSelected ? ', selected' : ''}`}`}
							onClick={() =>
								contribution ? setInspecting(contribution._id) : onToggle(index)
							}
							className={cn(
								'relative flex min-h-16 min-w-0 aspect-square flex-col items-center justify-center rounded-2xl border outline-none transition-[transform,background-color,border-color] duration-150 ease-out active:scale-[0.94] motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0b0e] disabled:cursor-not-allowed disabled:opacity-60',
								contribution
									? memberTone(member?.colorIndex ?? 0).fill
									: isSelected
										? 'border-indigo-400 bg-indigo-400/20 text-indigo-100'
										: 'border-white/10 bg-white/[0.03] text-zinc-200 hover:bg-white/[0.06]',
							)}
						>
							{contribution ? (
								<>
									<Avatar
										colorIndex={member?.colorIndex ?? 0}
										displayName={member?.displayName ?? 'Goal member'}
									/>
									<span className='mt-1 text-[11px] tabular-nums'>
										{formatCents(amount)}
									</span>
									<Check
										aria-hidden='true'
										className='absolute right-1 top-1 size-3'
									/>
								</>
							) : (
								<span className='max-w-full break-all px-1 font-heading text-sm font-semibold tabular-nums sm:text-base'>
									{formatCents(amount)}
								</span>
							)}
							{isSelected && (
								<span
									aria-hidden='true'
									className='absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-indigo-400 text-indigo-950 ring-2 ring-[#0b0b0e]'
								>
									<Check className='size-3' />
								</span>
							)}
						</button>
					);
				})}
			</div>
			<p className='mt-6 px-1 text-xs leading-relaxed text-zinc-400'>
				{DISCLAIMER}
			</p>
			{selected.size > 0 && !archived && (
				<div className='fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 mx-auto max-w-md'>
					<button
						type='button'
						disabled={pending}
						onClick={() => setConfirming(true)}
						className='flex w-full items-center justify-between rounded-2xl bg-indigo-400 px-5 py-3.5 text-left text-indigo-950 shadow-2xl shadow-black/40 outline-none hover:bg-indigo-300 focus-visible:ring-2 focus-visible:ring-white disabled:opacity-60'
					>
						<span>
							<span className='block text-xs'>
								{selected.size} {selected.size === 1 ? 'cell' : 'cells'}{' '}
								selected
							</span>
							<span className='block font-heading text-lg font-semibold tabular-nums'>
								Review {formatCents(total)}
							</span>
						</span>
						<ChevronUp className='size-5' />
					</button>
				</div>
			)}
			<Sheet
				open={confirming}
				onOpenChange={setConfirming}
				title='Record savings'
			>
				<p className='mt-2 text-sm text-zinc-400'>
					Record money you have set aside yourself. Finanz does not move money.
				</p>
				{warning && (
					<p role='alert' className='mt-3 text-sm text-amber-200'>
						{warning}
					</p>
				)}
				<ul aria-label='Selected cells' className='mt-4 flex flex-wrap gap-2'>
					{[...selected]
						.sort((a, b) => a - b)
						.map((index) => (
							<li
								key={index}
								className='flex items-center rounded-lg border border-indigo-400/30 bg-indigo-400/10 pl-3 text-sm text-indigo-100'
							>
								{formatCents(goal.cellAmountsCents[index])}
								<button
									type='button'
									disabled={pending}
									onClick={() => onToggle(index)}
									aria-label={`Deselect cell ${index + 1}`}
									className='rounded-lg p-2 focus-visible:ring-2 focus-visible:ring-indigo-300'
								>
									<X className='size-4' />
								</button>
							</li>
						))}
				</ul>
				<p className='mt-5 flex justify-between border-t border-white/10 pt-4'>
					<span>Total</span>
					<strong className='font-heading text-2xl tabular-nums'>
						{formatCents(total)}
					</strong>
				</p>
				{!selected.size && (
					<p className='mt-3 text-sm text-zinc-400'>
						No cells selected. Close this sheet to review the grid.
					</p>
				)}
				<div className='mt-5 flex gap-3'>
					<button
						type='button'
						onClick={() => setConfirming(false)}
						className='min-h-11 flex-1 rounded-xl border border-white/10'
					>
						Close
					</button>
					<button
						type='button'
						disabled={pending || archived || !selected.size}
						onClick={onRecord}
						className={cn(primaryButtonClass, 'flex-1')}
					>
						{pending ? 'Recording...' : `Record savings ${formatCents(total)}`}
					</button>
				</div>
			</Sheet>
			<Sheet
				open={inspecting !== null}
				onOpenChange={(open) => {
					if (!open) setInspecting(null);
				}}
				title='Recorded cell'
			>
				{warning && (
					<p role='alert' className='mt-3 text-sm text-amber-200'>
						{warning}
					</p>
				)}
				{inspected ? (
					<>
						<div className='mt-4 flex items-center gap-3'>
							<Avatar
								colorIndex={contributor?.colorIndex ?? 0}
								displayName={contributor?.displayName ?? 'Goal member'}
							/>
							<div>
								<p className='font-heading text-2xl font-semibold tabular-nums'>
									{formatCents(inspected.amountCents)}
								</p>
								<p className='text-sm text-zinc-400'>
									Recorded by {contributor?.displayName ?? 'Goal member'}
									{contributor?.removedAt != null ? ' (former member)' : ''} on{' '}
									{formatDate(inspected.recordedAt)} UTC.
								</p>
							</div>
						</div>
						{!archived &&
							(viewer.isOwner || inspected.contributorId === viewer.userId) && (
								<>
									<p className='mt-4 text-sm text-zinc-400'>
										Undo removes this amount from recorded savings and makes the
										cell available again. History is preserved.
									</p>
									<button
										type='button'
										disabled={pending}
										onClick={() => onUndo(inspected._id)}
										className='mt-4 min-h-11 w-full rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 text-rose-200 disabled:opacity-50'
									>
										{pending ? 'Working...' : 'Undo this Contribution'}
									</button>
								</>
							)}
					</>
				) : (
					<p role='status' className='mt-4 text-sm text-zinc-400'>
						This Contribution is no longer active. The grid has been updated.
					</p>
				)}
				<button
					type='button'
					onClick={() => setInspecting(null)}
					className='mt-4 min-h-11 w-full rounded-xl border border-white/10'
				>
					Close
				</button>
			</Sheet>
		</>
	);
}
