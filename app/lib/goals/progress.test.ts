import { describe, expect, test } from 'bun:test';
import { ConvexError } from 'convex/values';
import { calculateProgress } from './progress';

const goal = {
	targetCents: 600_000,
	recordedCents: 0,
	startDate: '2026-07-01',
	targetDate: '2027-03-14',
	today: '2026-07-01',
};

describe('calculateProgress', () => {
	test('planned pace includes the final saving day and remains unrounded', () => {
		const p = calculateProgress(goal);
		expect(p.planDays).toBe(257);
		expect(p.daysRemaining).toBe(257);
		expect(p.plannedWeeklyCents).toBeCloseTo((600_000 * 7) / 257, 8);
		expect(p.currentWeeklyCents).toBe(p.plannedWeeklyCents);
		expect(p.status).toBe('active');
	});

	test('upcoming permits recorded savings but uses planned pace, not catch-up', () => {
		const p = calculateProgress({
			...goal,
			today: '2026-06-01',
			recordedCents: 150_000,
		});
		expect(p.status).toBe('upcoming');
		expect(p.recordedCents).toBe(150_000);
		expect(p.remainingCents).toBe(450_000);
		expect(p.percent).toBe(25);
		expect(p.currentWeeklyCents).toBeNull();
	});

	test('target date is active; subsequent days are overdue with no rate', () => {
		const p = calculateProgress({
			...goal,
			recordedCents: 100,
			today: goal.targetDate,
		});
		expect(p.status).toBe('active');
		expect(p.daysRemaining).toBe(1);
		expect(p.currentWeeklyCents).toBe(599_900 * 7);
		for (const today of ['2027-03-15', '2028-01-01']) {
			const overdue = calculateProgress({ ...goal, today });
			expect(overdue.status).toBe('overdue');
			expect(overdue.daysRemaining).toBeLessThanOrEqual(0);
			expect(overdue.currentWeeklyCents).toBeNull();
		}
	});

	test('completion wins over all dates and undo reopens progress', () => {
		for (const today of ['2026-06-01', goal.startDate, '2028-01-01']) {
			const p = calculateProgress({
				...goal,
				today,
				recordedCents: goal.targetCents,
			});
			expect(p.status).toBe('completed');
			expect(p.remainingCents).toBe(0);
			expect(p.percent).toBe(100);
			expect(p.currentWeeklyCents).toBeNull();
		}
		expect(calculateProgress({ ...goal, recordedCents: 599_900 }).status).toBe(
			'active',
		);
	});

	test('calendar days ignore DST and cross leap, year and four-digit boundaries', () => {
		for (const [startDate, targetDate, days] of [
			['2026-03-07', '2026-03-09', 3],
			['2026-11-01', '2026-11-02', 2],
			['2028-02-28', '2028-03-01', 3],
			['2026-12-31', '2027-01-01', 2],
			['0099-12-31', '0100-01-01', 2],
			['9999-12-30', '9999-12-31', 2],
		] as const) {
			expect(
				calculateProgress({ ...goal, startDate, targetDate, today: startDate })
					.planDays,
			).toBe(days);
		}
	});

	test('deadline edits recalculate both rates and today defaults to UTC', () => {
		const extended = calculateProgress({ ...goal, targetDate: '2027-04-14' });
		expect(extended.plannedWeeklyCents).toBeLessThan(
			calculateProgress(goal).plannedWeeklyCents,
		);
		expect(extended.currentWeeklyCents!).toBeLessThan(
			calculateProgress(goal).currentWeeklyCents!,
		);
		expect(calculateProgress({ ...goal, today: undefined }).today).toBe(
			new Date().toISOString().slice(0, 10),
		);
	});

	test('invalid money and dates fail rather than producing misleading progress', () => {
		for (const override of [
			{ targetCents: 0 },
			{ targetCents: Infinity },
			{ targetCents: Number.MAX_SAFE_INTEGER },
			{ recordedCents: -100 },
			{ recordedCents: 1 },
			{ recordedCents: NaN },
			{ recordedCents: 600_100 },
			{ startDate: '2026-02-30' },
			{ targetDate: goal.startDate },
			{ targetDate: '2020-01-01' },
			{ today: 'bad' },
		])
			expect(() => calculateProgress({ ...goal, ...override })).toThrow(
				ConvexError,
			);
	});
});
