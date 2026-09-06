export const authResponseHeaders = {
	'Cache-Control': 'no-store',
	'Referrer-Policy': 'no-referrer',
};

export function safeReturnTo(value: string | null | undefined): string {
	if (!value) return '/';

	let decoded = value;
	// Check every encoding layer, but return the original URL without changing tokens.
	for (let depth = 0; depth < 8; depth++) {
		if (
			!decoded.startsWith('/') ||
			decoded.startsWith('//') ||
			/[\\\u0000-\u001f\u007f-\u009f]/.test(decoded)
		)
			return '/';

		try {
			const url = new URL(decoded, 'https://finanz.invalid');
			if (
				url.origin !== 'https://finanz.invalid' ||
				url.pathname.startsWith('//') ||
				/^\/sign-(?:in|up)(?:\/|$)/i.test(url.pathname)
			)
				return '/';

			const next = decodeURIComponent(decoded);
			if (next === decoded) return value;
			decoded = next;
		} catch {
			return '/';
		}
	}

	return '/';
}
