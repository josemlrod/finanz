import { describe, expect, test } from 'bun:test';
import { reconcileRecordAttempt } from './record-attempt';

const attempt = { fingerprint: '[1,[0,1]]', submissionId: 'lost-response' };
const recorded = {
	contributorId: 'viewer',
	submissionId: attempt.submissionId,
	undoneAt: null,
};

describe('record attempt reconciliation', () => {
	test('a reload with confirmed own savings ends the attempt before undo and re-record', () => {
		const restored = JSON.parse(JSON.stringify(attempt));
		const reconciled = reconcileRecordAttempt(restored, 'viewer', [recorded]);
		expect(reconciled).toBeNull();
		expect(reconcileRecordAttempt(reconciled, 'viewer', [])).toBeNull();
	});

	test('an undone Contribution in loaded history still confirms success', () => {
		expect(
			reconcileRecordAttempt(attempt, 'viewer', [
				{ ...recorded, undoneAt: '2026-09-05' },
			]),
		).toBeNull();
	});

	test('an attempt absent from bounded history remains unresolved', () => {
		expect(reconcileRecordAttempt(attempt, 'viewer', [])).toEqual(attempt);
	});

	test('another contributor using the same ID cannot confirm this attempt', () => {
		expect(
			reconcileRecordAttempt(attempt, 'viewer', [
				{ ...recorded, contributorId: 'other' },
			]),
		).toEqual(attempt);
	});

	test('a different submission cannot confirm this attempt', () => {
		expect(
			reconcileRecordAttempt(attempt, 'viewer', [
				{ ...recorded, submissionId: 'other-attempt' },
			]),
		).toEqual(attempt);
	});

	test('invalid stored values are not restored', () => {
		for (const invalid of [
			null,
			'invalid',
			{},
			{ fingerprint: 1, submissionId: 'id' },
		]) {
			expect(reconcileRecordAttempt(invalid, 'viewer', [])).toBeNull();
		}
	});
});
