import { describe, expect, test } from 'bun:test';
import { ConvexError } from 'convex/values';
import {
	addCalendarMonths,
	generateGrid,
	parseWholeDollars,
	todayUtc,
	validateDate,
	validateGoalConfig,
} from './goals';

function invalid(run: () => unknown) {
	try {
		run();
	} catch (error) {
		expect(error).toBeInstanceOf(ConvexError);
		expect((error as ConvexError<{ code: string }>).data.code).toBe(
			'INVALID_INPUT',
		);
		return;
	}
	throw new Error('Expected INVALID_INPUT');
}

describe('money and configuration', () => {
	test('parses whole dollars and trims names without mutating input', () => {
		expect(parseWholeDollars(' 00125 ')).toBe(12_500);
		expect(parseWholeDollars(125)).toBe(12_500);
		const config = {
			name: '  Trip  ',
			targetCents: 10_000,
			minCellCents: 4_000,
			maxCellCents: 16_000,
			startDate: '2020-01-01',
			targetDate: '2020-02-01',
		};
		expect(validateGoalConfig(config)).toEqual({ ...config, name: 'Trip' });
		expect(config.name).toBe('  Trip  ');
		invalid(() => validateGoalConfig({ ...config, name: ' ' }));
		invalid(() =>
			validateGoalConfig({ ...config, targetDate: config.startDate }),
		);
		invalid(() => validateGoalConfig({ ...config, targetDate: '2019-01-01' }));
		invalid(() => validateGoalConfig({ ...config, targetCents: 100 }));
	});

	test('rejects malformed, fractional, non-finite and overflowing money', () => {
		for (const value of [
			null,
			undefined,
			{},
			[],
			true,
			'',
			' ',
			'1.00',
			'1.5',
			'1e3',
			'0x10',
			'$10',
			'1,000',
			'+1',
			'-1',
			0,
			-1,
			1.5,
			NaN,
			Infinity,
			Number.MAX_SAFE_INTEGER,
			'90071992547410',
		]) {
			invalid(() => parseWholeDollars(value));
		}
		expect(parseWholeDollars('90071992547409')).toBe(9_007_199_254_740_900);
		for (const value of [
			0,
			-100,
			101,
			NaN,
			Infinity,
			Number.MAX_SAFE_INTEGER,
			9_007_199_254_741_000,
		]) {
			invalid(() => generateGrid(value, 100, 100));
			invalid(() => generateGrid(100, value, 100));
			invalid(() => generateGrid(100, 100, value));
		}
	});
});

describe('grid generation', () => {
	test('spreads the representative preview across low and high denominations', () => {
		const cells = generateGrid(1_000_000, 1_000, 10_000);
		expect(cells).toEqual(generateGrid(1_000_000, 1_000, 10_000));
		expect(cells.reduce((sum, cell) => sum + cell, 0)).toBe(1_000_000);
		expect(Math.min(...cells)).toBe(1_000);
		expect(Math.max(...cells)).toBe(10_000);
		expect(new Set(cells).size).toBeGreaterThanOrEqual(15);
		expect(
			cells.filter((cell) => cell % 500 === 0).length / cells.length,
		).toBeGreaterThan(0.9);
	});

	test('prefers variation over a singleton and handles forced equality', () => {
		expect(generateGrid(10_000, 4_000, 16_000)).toEqual([4_000, 6_000]);
		expect(generateGrid(8_000, 4_000, 5_000)).toEqual([4_000, 4_000]);
		expect(generateGrid(10_000, 5_000, 5_000)).toEqual([5_000, 5_000]);
		expect(generateGrid(5_000, 4_000, 6_000)).toEqual([5_000]);
		expect(generateGrid(50_000, 100, 100)).toHaveLength(500);
		invalid(() => generateGrid(50_100, 100, 100));
		invalid(() => generateGrid(100, 200, 300));
		invalid(() => generateGrid(700, 400, 600));
		invalid(() => generateGrid(1_000, 500, 400));
	});

	test('exhaustive small inputs satisfy feasibility, sum, bounds and possible variation', () => {
		for (let low = 1; low <= 10; low++) {
			for (let high = low; high <= 15; high++) {
				for (let target = 1; target <= 100; target++) {
					const first = Math.ceil(target / high);
					const last = Math.min(Math.floor(target / low), 500);
					if (first > last) {
						invalid(() => generateGrid(target * 100, low * 100, high * 100));
						continue;
					}
					const cells = generateGrid(target * 100, low * 100, high * 100);
					expect(cells.length >= first && cells.length <= last).toBe(true);
					expect(cells.reduce((a, b) => a + b, 0)).toBe(target * 100);
					expect(
						cells.every(
							(c) => c % 100 === 0 && c >= low * 100 && c <= high * 100,
						),
					).toBe(true);
					const varied = Array.from(
						{ length: last - first + 1 },
						(_, i) => first + i,
					).some(
						(n) => n > 1 && low < high && n * low < target && target < n * high,
					);
					expect(new Set(cells).size > 1).toBe(varied);
				}
			}
		}
	});

	test('large safe amounts retain exact sums even when bound products overflow numbers', () => {
		const target = 9_007_199_254_740_900;
		for (const [low, high] of [
			[100, target],
			[100, 18_014_398_509_500],
			[target, target],
		]) {
			const cells = generateGrid(target, low, high);
			expect(cells.length).toBeLessThanOrEqual(500);
			expect(cells.reduce((sum, c) => sum + BigInt(c), 0n)).toBe(
				BigInt(target),
			);
			expect(
				cells.every(
					(c) =>
						Number.isSafeInteger(c) && c % 100 === 0 && c >= low && c <= high,
				),
			).toBe(true);
		}
		invalid(() => generateGrid(target, 100, 18_014_398_509_400));
	});
});

describe('UTC dates', () => {
	test('validates actual dates, including early years and leap centuries', () => {
		for (const date of [
			'0000-02-29',
			'0099-01-01',
			'2000-02-29',
			'2028-02-29',
			'9999-12-31',
		])
			expect(validateDate(date)).toBe(date);
		for (const date of [
			'1900-02-29',
			'2026-02-29',
			'2026-04-31',
			'2026-13-01',
			'2026-00-01',
			'2026-01-00',
			'2026-1-01',
			' 2026-01-01',
			'2026-01-01T00:00:00Z',
			'10000-01-01',
		])
			invalid(() => validateDate(date));
	});

	test('calendar months clamp rather than overflow and preserve UTC years', () => {
		expect(addCalendarMonths('2026-01-31', 1)).toBe('2026-02-28');
		expect(addCalendarMonths('2028-01-31', 1)).toBe('2028-02-29');
		expect(addCalendarMonths('2028-02-29', 12)).toBe('2029-02-28');
		expect(addCalendarMonths('2026-03-31', -1)).toBe('2026-02-28');
		expect(addCalendarMonths('2026-10-31', 6)).toBe('2027-04-30');
		expect(addCalendarMonths('0099-12-31', 1)).toBe('0100-01-31');
		expect(addCalendarMonths('9999-12-31', 0)).toBe('9999-12-31');
		for (const months of [0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER])
			invalid(() => addCalendarMonths('2026-01-01', months));
		invalid(() => addCalendarMonths('9999-12-31', 1));
		invalid(() => addCalendarMonths('0000-01-01', -1));
		expect(todayUtc()).toBe(new Date().toISOString().slice(0, 10));
	});
});
