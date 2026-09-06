import { describe, expect, test } from 'bun:test';
import { safeReturnTo } from './auth-redirect';

describe('safeReturnTo', () => {
	test.each([
		'/',
		'/goals',
		'/invites/secret-token_123',
		'/invites/token?source=email&label=hello%20there#accept',
		'/goals?next=https%3A%2F%2Fexample.com',
		'/sign-instructions',
	])('preserves a safe destination: %s', (value) => {
		expect(safeReturnTo(value)).toBe(value);
	});

	test.each([
		null,
		undefined,
		'',
		'goals',
		'https://example.com',
		'https://finanz.invalid/goals',
		'javascript:alert(1)',
		'//example.com',
		'///example.com',
		'/\\example.com',
		'/goals\\elsewhere',
		'/\n/example.com',
		'/goals\t',
		'/goals\u007f',
		'/%2fexample.com',
		'/%252fexample.com',
		'/%5cexample.com',
		'/%255cexample.com',
		'/goals?x=%0d%0aLocation:evil',
		'/goals#%2500',
		'/goals?x=%C2%85',
		'/%',
		'/%zz',
		' /goals',
		'/sign-in',
		'/sign-up?returnTo=/goals',
		'/SIGN-IN/',
		'/sign-up/code',
		'/%73ign-in',
		'/%2573ign-up',
		'/goals/../sign-in',
		'/goals/%2e%2e/sign-up',
		'/goals/%252e%252e/sign-in',
		'/.//example.com',
		'/goals/..//example.com',
		'/sign-in%3FreturnTo=/goals',
	])('falls back for an unsafe destination: %s', (value) => {
		expect(safeReturnTo(value)).toBe('/');
	});

	test('rejects deeply encoded bypasses without unbounded decoding', () => {
		let value = '/%2fevil.example';
		for (let i = 0; i < 12; i++) value = value.replaceAll('%', '%25');
		expect(safeReturnTo(value)).toBe('/');
	});

	test('preserves an invite through both encoded auth cross-links', () => {
		const destination = '/invites/secret-token?label=a%20b&source=email#accept';
		let returnTo = destination;
		for (const path of ['/sign-in', '/sign-up', '/sign-in']) {
			const url = new URL(path, 'https://finanz.invalid');
			url.search = new URLSearchParams({ returnTo }).toString();
			returnTo = safeReturnTo(url.searchParams.get('returnTo'));
			expect(returnTo).toBe(destination);
		}
	});
});
