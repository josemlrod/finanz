import { ConvexError } from 'convex/values';
import { useId, useState } from 'react';
import {
	addCalendarMonths,
	generateGrid,
	parseWholeDollars,
	todayUtc,
	validateGoalConfig,
	type GoalConfig,
} from '../../../convex/lib/goals';
import { calculateProgress } from '~/lib/goals/progress';
import {
	DISCLAIMER,
	formatCents,
	inputClass,
	primaryButtonClass,
} from './shared';

export function GoalForm({
	initial,
	locked = false,
	disabled = false,
	submitLabel = 'Create goal',
	onSubmit,
	pending = false,
}: {
	initial?: GoalConfig;
	locked?: boolean;
	disabled?: boolean;
	submitLabel?: string;
	onSubmit: (config: GoalConfig) => void;
	pending?: boolean;
}) {
	const id = useId();
	const [fields, setFields] = useState(() => {
		const startDate = initial?.startDate ?? todayUtc();
		return {
			name: initial?.name ?? '',
			target: String((initial?.targetCents ?? 100000) / 100),
			minimum: String((initial?.minCellCents ?? 1000) / 100),
			maximum: String((initial?.maxCellCents ?? 10000) / 100),
			startDate,
			targetDate: initial?.targetDate ?? addCalendarMonths(startDate, 6),
		};
	});
	const [preview, setPreview] = useState<{
		config: GoalConfig;
		cells: number[];
		weeklyCents: number;
	} | null>(null);
	const [error, setError] = useState<string | null>(null);
	const busy = disabled || pending;

	function change(key: keyof typeof fields, value: string) {
		setFields({ ...fields, [key]: value });
		setPreview(null);
		setError(null);
	}

	function showError(error: unknown) {
		setError(
			error instanceof ConvexError &&
				typeof error.data === 'object' &&
				error.data !== null &&
				typeof error.data.message === 'string'
				? error.data.message
				: 'Unable to preview this goal. Check the amounts and dates and try again.',
		);
	}

	return (
		<form
			className='mt-3 space-y-5'
			aria-busy={pending}
			onSubmit={(event) => {
				event.preventDefault();
				if (busy) return;
				if (preview) {
					onSubmit(preview.config);
					return;
				}
				try {
					const config = validateGoalConfig({
						name: fields.name,
						targetCents:
							locked && initial
								? initial.targetCents
								: parseWholeDollars(fields.target),
						minCellCents:
							locked && initial
								? initial.minCellCents
								: parseWholeDollars(fields.minimum),
						maxCellCents:
							locked && initial
								? initial.maxCellCents
								: parseWholeDollars(fields.maximum),
						startDate: locked && initial ? initial.startDate : fields.startDate,
						targetDate: fields.targetDate,
					});
					const cells = generateGrid(
						config.targetCents,
						config.minCellCents,
						config.maxCellCents,
					);
					const progress = calculateProgress({ ...config, recordedCents: 0 });
					setPreview({
						config,
						cells,
						weeklyCents: progress.plannedWeeklyCents,
					});
					setError(null);
				} catch (error) {
					showError(error);
				}
			}}
		>
			<p className='text-sm leading-relaxed text-zinc-400'>
				Choose a target, then complete whole-dollar cells at your own pace.
			</p>
			<fieldset disabled={busy} className='space-y-4'>
				<div className='space-y-1.5'>
					<label htmlFor={`${id}-name`} className='text-sm text-zinc-300'>
						Goal name
					</label>
					<input
						id={`${id}-name`}
						name='name'
						className={inputClass}
						value={fields.name}
						onChange={(e) => change('name', e.target.value)}
						required
						placeholder='Emergency fund'
					/>
				</div>
				{(
					[
						['target', 'Target amount'],
						['minimum', 'Minimum cell amount'],
						['maximum', 'Maximum cell amount'],
					] as const
				).map(([key, label]) => (
					<div key={key} className='space-y-1.5'>
						<label htmlFor={`${id}-${key}`} className='text-sm text-zinc-300'>
							{label} <span className='text-zinc-500'>USD</span>
						</label>
						<input
							id={`${id}-${key}`}
							className={inputClass}
							type='text'
							inputMode='numeric'
							pattern='[0-9]+'
							required
							readOnly={locked}
							value={fields[key]}
							onChange={(e) => change(key, e.target.value)}
							aria-describedby={`${id}-amount-help`}
							title='Enter a positive whole-dollar amount without decimals.'
						/>
					</div>
				))}
				<p
					id={`${id}-amount-help`}
					className='text-xs leading-relaxed text-zinc-500'
				>
					Whole dollars only. Every cell stays within your minimum and maximum,
					with up to 500 cells.
				</p>
				<div className='grid gap-4 sm:grid-cols-2'>
					<div className='min-w-0 space-y-1.5'>
						<label htmlFor={`${id}-start`} className='text-sm text-zinc-300'>
							Start date
						</label>
						<input
							id={`${id}-start`}
							name='startDate'
							type='date'
							required
							readOnly={locked}
							className={inputClass}
							value={fields.startDate}
							onChange={(e) => change('startDate', e.target.value)}
						/>
					</div>
					<div className='min-w-0 space-y-1.5'>
						<label htmlFor={`${id}-end`} className='text-sm text-zinc-300'>
							Target date
						</label>
						<input
							id={`${id}-end`}
							name='targetDate'
							type='date'
							required
							className={inputClass}
							value={fields.targetDate}
							onChange={(e) => change('targetDate', e.target.value)}
						/>
					</div>
				</div>
				<button
					type='button'
					className='min-h-11 rounded-xl border border-indigo-400/25 bg-indigo-400/10 px-3 text-sm text-indigo-200 hover:bg-indigo-400/20 focus-visible:outline-indigo-400'
					onClick={() => {
						setPreview(null);
						try {
							change('targetDate', addCalendarMonths(fields.startDate, 6));
						} catch (error) {
							showError(error);
						}
					}}
				>
					Set target to 6 months after start
				</button>
				<p className='text-xs leading-relaxed text-zinc-500'>
					Dates and pacing use UTC. Dates change the pace, not the cells.
				</p>
				{locked ? (
					<p className='rounded-xl border border-white/10 p-3 text-xs leading-relaxed text-zinc-400'>
						Target, cell bounds, and start date are permanently locked after the
						first Contribution, even if it is undone. You can still edit the
						name and target date.
					</p>
				) : null}
			</fieldset>

			{error ? (
				<p
					id={`${id}-error`}
					role='alert'
					className='rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-sm text-amber-200'
				>
					{error}
				</p>
			) : null}
			{preview ? (
				<section
					aria-label='Goal preview'
					className='space-y-4 rounded-2xl border border-indigo-400/25 bg-indigo-400/[0.04] p-4'
				>
					<div aria-live='polite'>
						<h3 className='font-heading text-lg font-semibold'>
							Your savings grid
						</h3>
						<p className='mt-1 text-sm text-zinc-400'>
							{preview.cells.length} cells totaling{' '}
							<span className='tabular-nums text-zinc-100'>
								{formatCents(preview.config.targetCents)}
							</span>
						</p>
						<p className='mt-1 text-sm text-zinc-400'>
							Planned average{' '}
							<span className='tabular-nums text-indigo-200'>
								{formatCents(preview.weeklyCents)}/week
							</span>
						</p>
					</div>
					{preview.cells.every((amount) => amount === preview.cells[0]) ? (
						<p className='text-xs leading-relaxed text-zinc-400'>
							These bounds only allow equal cell amounts. Every cell is{' '}
							{formatCents(preview.cells[0])} so the grid reaches your exact
							target.
						</p>
					) : null}
					<ul
						aria-label='Preview cell amounts'
						tabIndex={0}
						className='grid max-h-72 grid-cols-3 gap-2 overflow-y-auto rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 sm:grid-cols-5'
					>
						{preview.cells.map((amount, index) => (
							<li
								key={index}
								className='flex aspect-square items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.03] px-1 font-heading text-sm font-semibold tabular-nums text-zinc-200'
							>
								{formatCents(amount)}
							</li>
						))}
					</ul>
					<p className='text-xs leading-relaxed text-zinc-400'>
						Review these amounts before confirming. Changing any field requires
						a new preview.
					</p>
				</section>
			) : null}
			<p className='text-xs leading-relaxed text-zinc-500'>{DISCLAIMER}</p>
			<button
				type='submit'
				disabled={busy}
				className={`${primaryButtonClass} w-full`}
				aria-describedby={error ? `${id}-error` : undefined}
			>
				{pending ? 'Saving...' : preview ? submitLabel : 'Preview grid'}
			</button>
		</form>
	);
}
