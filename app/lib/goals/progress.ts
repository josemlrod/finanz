import { ConvexError } from 'convex/values';
import { todayUtc, validateDate } from '../../../convex/lib/goals';

export function calculateProgress({
	targetCents,
	recordedCents,
	startDate,
	targetDate,
	today = todayUtc(),
}: {
	targetCents: number;
	recordedCents: number;
	startDate: string;
	targetDate: string;
	today?: string;
}) {
	if (
		!Number.isSafeInteger(targetCents) ||
		targetCents <= 0 ||
		targetCents % 100 !== 0 ||
		!Number.isSafeInteger(recordedCents) ||
		recordedCents < 0 ||
		recordedCents % 100 !== 0 ||
		recordedCents > targetCents
	) {
		throw new ConvexError({
			code: 'INVALID_INPUT',
			message:
				'Recorded savings must be whole dollars between zero and the positive target.',
		});
	}
	for (const date of [startDate, targetDate, today]) validateDate(date);
	if (targetDate <= startDate) {
		throw new ConvexError({
			code: 'INVALID_INPUT',
			message: 'Target date must be after start date.',
		});
	}
	const day = (date: string) =>
		Date.parse(`${date}T00:00:00.000Z`) / 86_400_000;
	const endExclusive = day(targetDate) + 1;
	const planDays = endExclusive - day(startDate);
	const daysRemaining = endExclusive - day(today);
	const remainingCents = targetCents - recordedCents;
	const status: 'upcoming' | 'active' | 'overdue' | 'completed' =
		remainingCents === 0
			? 'completed'
			: today < startDate
				? 'upcoming'
				: daysRemaining <= 0
					? 'overdue'
					: 'active';
	return {
		recordedCents,
		remainingCents,
		percent: (recordedCents / targetCents) * 100,
		status,
		plannedWeeklyCents: (targetCents / planDays) * 7,
		currentWeeklyCents:
			status === 'active' ? (remainingCents / daysRemaining) * 7 : null,
		daysRemaining,
		planDays,
		today,
	};
}
