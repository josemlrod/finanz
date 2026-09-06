export type RecordAttempt = { fingerprint: string; submissionId: string };

export function reconcileRecordAttempt(
	attempt: unknown,
	viewerId: string,
	contributions: readonly { contributorId: string; submissionId: string }[],
): RecordAttempt | null {
	if (
		!attempt ||
		typeof attempt !== 'object' ||
		!('fingerprint' in attempt) ||
		!('submissionId' in attempt) ||
		typeof attempt.fingerprint !== 'string' ||
		typeof attempt.submissionId !== 'string'
	)
		return null;
	// Undone Contributions also prove that this attempt already succeeded.
	if (
		contributions.some(
			(row) =>
				row.contributorId === viewerId &&
				row.submissionId === attempt.submissionId,
		)
	)
		return null;
	return {
		fingerprint: attempt.fingerprint,
		submissionId: attempt.submissionId,
	};
}
