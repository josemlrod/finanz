import { Dialog } from '@base-ui/react/dialog';
import { ArrowLeft, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

const dollars = new Intl.NumberFormat('en-US', {
	style: 'currency',
	currency: 'USD',
	maximumFractionDigits: 0,
});

export function formatCents(cents: number) {
	return dollars.format(cents / 100);
}

export function formatDate(date: string) {
	return new Date(
		date.length === 10 ? `${date}T00:00:00Z` : date,
	).toLocaleDateString('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		timeZone: 'UTC',
	});
}

export const DISCLAIMER =
	'Finanz tracks completed savings steps. It does not move money or check that recorded savings are still available.';

export const panelClass = 'rounded-3xl border border-white/10 bg-[#101014]';
export const inputClass =
	'min-h-11 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-base text-zinc-100 outline-none placeholder:text-zinc-600 focus-visible:ring-2 focus-visible:ring-indigo-400/70 read-only:text-zinc-500 disabled:opacity-50 [color-scheme:dark]';
export const primaryButtonClass =
	'inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-indigo-400 px-5 py-3 text-sm font-semibold text-indigo-950 outline-none transition-[transform,background-color] duration-200 ease-out hover:bg-indigo-300 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0b0e] disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100';

const tones = [
	{
		hex: '#818cf8',
		fill: 'bg-indigo-400/15 border-indigo-400/25',
		avatar: 'bg-indigo-400 text-indigo-950',
	},
	{
		hex: '#34d399',
		fill: 'bg-emerald-400/15 border-emerald-400/25',
		avatar: 'bg-emerald-400 text-emerald-950',
	},
	{
		hex: '#fbbf24',
		fill: 'bg-amber-400/15 border-amber-400/25',
		avatar: 'bg-amber-400 text-amber-950',
	},
	{
		hex: '#38bdf8',
		fill: 'bg-sky-400/15 border-sky-400/25',
		avatar: 'bg-sky-400 text-sky-950',
	},
	{
		hex: '#c084fc',
		fill: 'bg-purple-400/15 border-purple-400/25',
		avatar: 'bg-purple-400 text-purple-950',
	},
	{
		hex: '#fb7185',
		fill: 'bg-rose-400/15 border-rose-400/25',
		avatar: 'bg-rose-400 text-rose-950',
	},
];

export function memberTone(colorIndex: number) {
	const index = Number.isSafeInteger(colorIndex) ? colorIndex : 0;
	return tones[((index % tones.length) + tones.length) % tones.length];
}

export function Avatar({
	colorIndex,
	displayName,
}: {
	colorIndex: number;
	displayName: string;
}) {
	return (
		<span
			aria-hidden='true'
			className={`flex size-8 shrink-0 items-center justify-center rounded-full font-heading text-xs font-semibold ${memberTone(colorIndex).avatar}`}
		>
			{Array.from(displayName.trim())[0]?.toUpperCase() || '?'}
		</span>
	);
}

export function GoalHeader({
	backTo = '/goals',
	backLabel = 'Savings goals',
	children,
}: {
	backTo?: string;
	backLabel?: string;
	children?: ReactNode;
}) {
	return (
		<header className='flex min-h-20 flex-wrap items-center justify-between gap-3 py-4'>
			<div className='flex items-center gap-3'>
				<Link
					to='/'
					className='rounded font-heading text-lg font-semibold tracking-tight focus-visible:outline-indigo-400'
				>
					Finanz
				</Link>
				<span aria-hidden='true' className='text-zinc-700'>
					/
				</span>
				<Link
					to={backTo}
					className='flex min-h-11 items-center gap-1.5 rounded text-xs text-zinc-400 hover:text-white focus-visible:outline-indigo-400'
				>
					<ArrowLeft aria-hidden='true' className='size-3.5' />
					{backLabel}
				</Link>
			</div>
			<div className='flex flex-wrap items-center gap-2'>{children}</div>
		</header>
	);
}

export function Sheet({
	open,
	onOpenChange,
	title,
	children,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	children: ReactNode;
}) {
	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				<Dialog.Backdrop className='fixed inset-0 z-50 bg-black/60 transition-opacity duration-200 ease-out data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none' />
				<Dialog.Popup className='fixed inset-x-0 bottom-0 z-50 max-h-[90dvh] overflow-y-auto overscroll-contain rounded-t-3xl border border-white/10 bg-[#101014] px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-5 text-zinc-100 shadow-2xl shadow-black/50 outline-none transition-[transform,opacity] duration-200 ease-out data-[starting-style]:translate-y-full data-[ending-style]:translate-y-full motion-reduce:transition-none sm:inset-x-auto sm:bottom-6 sm:left-1/2 sm:max-h-[calc(100dvh-3rem)] sm:w-[36rem] sm:max-w-[calc(100vw-3rem)] sm:-translate-x-1/2 sm:rounded-3xl sm:data-[starting-style]:translate-y-4 sm:data-[ending-style]:translate-y-4 sm:data-[starting-style]:opacity-0 sm:data-[ending-style]:opacity-0'>
					<div
						aria-hidden='true'
						className='mx-auto mb-3 h-1 w-10 rounded-full bg-white/15 sm:hidden'
					/>
					<div className='flex items-center justify-between gap-4'>
						<Dialog.Title className='font-heading text-xl font-semibold tracking-tight'>
							{title}
						</Dialog.Title>
						<Dialog.Close
							aria-label='Close dialog'
							className='flex size-11 shrink-0 items-center justify-center rounded-xl text-zinc-400 hover:bg-white/5 hover:text-white focus-visible:outline-indigo-400'
						>
							<X aria-hidden='true' className='size-5' />
						</Dialog.Close>
					</div>
					{children}
				</Dialog.Popup>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
