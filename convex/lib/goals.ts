import { ConvexError } from 'convex/values';

export type GoalConfig = {
	name: string;
	targetCents: number;
	minCellCents: number;
	maxCellCents: number;
	startDate: string;
	targetDate: string;
};

function invalid(message: string): never {
	throw new ConvexError({ code: 'INVALID_INPUT', message });
}

function validateCents(value: number): void {
	if (!Number.isSafeInteger(value) || value <= 0 || value % 100 !== 0) {
		invalid(
			'Amounts must be positive whole dollars within the safe integer range.',
		);
	}
}

export function parseWholeDollars(value: unknown): number {
	if (typeof value === 'string') {
		if (!/^\d+$/.test(value.trim()))
			invalid('Enter a positive whole-dollar amount.');
		value = Number(value.trim());
	}
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
		invalid('Enter a positive whole-dollar amount.');
	}
	const cents = value * 100;
	validateCents(cents);
	return cents;
}

export function validateDate(value: string): string {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		invalid('Dates must use YYYY-MM-DD.');
	}
	const date = new Date(`${value}T00:00:00.000Z`);
	if (
		!Number.isFinite(date.getTime()) ||
		date.toISOString().slice(0, 10) !== value
	) {
		invalid('Enter a valid calendar date.');
	}
	return value;
}

export function addCalendarMonths(date: string, months: number): string {
	validateDate(date);
	if (!Number.isSafeInteger(months)) invalid('Months must be a safe integer.');
	const [year, month, day] = date.split('-').map(Number);
	const destination = year * 12 + month - 1 + months;
	if (
		!Number.isSafeInteger(destination) ||
		destination < 0 ||
		destination >= 120_000
	) {
		invalid('The resulting date must have a four-digit year.');
	}
	const result = new Date(`${date}T00:00:00.000Z`);
	result.setUTCDate(1);
	result.setUTCFullYear(
		Math.floor(destination / 12),
		(destination % 12) + 1,
		0,
	);
	result.setUTCDate(Math.min(day, result.getUTCDate()));
	return validateDate(result.toISOString().slice(0, 10));
}

export function todayUtc(): string {
	return new Date().toISOString().slice(0, 10);
}

export function validateGoalConfig(input: GoalConfig): GoalConfig {
	if (!input || typeof input.name !== 'string' || !input.name.trim()) {
		invalid('A goal name is required.');
	}
	validateDate(input.startDate);
	validateDate(input.targetDate);
	if (input.targetDate <= input.startDate)
		invalid('Target date must be after start date.');
	generateGrid(input.targetCents, input.minCellCents, input.maxCellCents);
	return { ...input, name: input.name.trim() };
}

export function generateGrid(
	targetCents: number,
	minCellCents: number,
	maxCellCents: number,
): number[] {
	for (const value of [targetCents, minCellCents, maxCellCents])
		validateCents(value);
	if (minCellCents > maxCellCents)
		invalid('Minimum cell amount must not exceed maximum.');
	const target = BigInt(targetCents / 100);
	const low = BigInt(minCellCents / 100);
	const high = BigInt(maxCellCents / 100);
	const first = (target + high - 1n) / high;
	const last = target / low < 500n ? target / low : 500n;
	if (first > last)
		invalid('No grid fits these amounts within the 500-cell limit.');

	let count = Number(first);
	let bestDistance = Infinity;
	let hasVariation = false;
	const midpoint = Number(low + high) / 2;
	for (let n = Number(first); n <= Number(last); n++) {
		const varied =
			n > 1 &&
			low < high &&
			target > BigInt(n) * low &&
			target < BigInt(n) * high;
		const distance = Math.abs(Number(target) / n - midpoint);
		if (
			(varied && !hasVariation) ||
			(varied === hasVariation && distance < bestDistance)
		) {
			count = n;
			bestDistance = distance;
			hasVariation = varied;
		}
	}

	const cells: bigint[] = [];
	let remaining = target;
	for (let i = 0; i < count; i++) {
		const rest = BigInt(count - i - 1);
		const minimum =
			remaining - rest * high > low ? remaining - rest * high : low;
		const maximum =
			remaining - rest * low < high ? remaining - rest * low : high;
		// Alternate low and high points of a ramp, retaining enough for every remaining cell.
		const rank =
			i % 2 === 0 ? Math.floor(i / 2) : count - 1 - Math.floor(i / 2);
		let amount =
			count === 1
				? remaining
				: low + ((high - low) * BigInt(rank)) / BigInt(count - 1);
		amount = ((amount + 2n) / 5n) * 5n;
		amount = amount < minimum ? minimum : amount > maximum ? maximum : amount;
		cells.push(amount);
		remaining -= amount;
	}
	if (hasVariation && cells.every((amount) => amount === cells[0])) {
		cells[0] -= 1n;
		cells[1] += 1n;
	}
	return cells.map((amount) => Number(amount * 100n));
}
