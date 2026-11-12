// The profiler login's `next` (where the form goes after a good key) never leaves the app's origin,
// whatever the visitor posts and wherever the profiler is mounted (#1111): read by the WHATWG URL
// parser, as the browser's `location.href = next` reads it.
import { describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { fc } from '@ogygia/config/sim';
import { profiler } from '../src/profiler/index.ts';

vi.mock('../src/profiler/env.ts', () => ({ detect_dev: () => true }));

const SECRET = 'prof-key-of-16-bytes-or-more';

async function login(path: string, next: string): Promise<string> {
	const url = `https://app.test${path}/login`;
	const res = await profiler({ secret: SECRET, path })({
		event: {
			url: new URL(url),
			request: new Request(url, {
				method: 'POST',
				body: JSON.stringify({ key: SECRET, next })
			}),
			route: { id: null },
			cookies: {
				get: () => undefined,
				set() {},
				delete() {},
				getAll: () => [],
				serialize: () => ''
			},
			getClientAddress: () => '203.0.113.7',
			fetch: async () => new Response('ok')
		} as unknown as RequestEvent,
		resolve: async () => new Response('app')
	});
	return ((await res.json()) as { next: string }).next;
}

describe("the login's next", () => {
	it('a protocol-relative or backslash next goes to the profiler, at the root too', async () => {
		for (const path of ['', '/__profiler'])
			for (const next of [
				'//evil.example',
				'/\\evil.example',
				'\\\\evil.example',
				'https://evil.example'
			])
				expect(new URL(await login(path, next), 'https://app.test').origin).toBe(
					'https://app.test'
				);
	});

	it('any next stays on the origin and under the base; one already there is kept', async () => {
		const piece = fc.constantFrom(
			'/',
			'\\',
			'.',
			'..',
			'%2f',
			'%5c',
			'evil.example',
			':',
			'@',
			'x',
			'?',
			'#',
			'\t'
		);
		await fc.assert(
			fc.asyncProperty(
				fc.constantFrom('', '/__profiler'),
				fc.array(piece, { maxLength: 6 }),
				async (path, parts) => {
					const next = parts.join('');
					const went = new URL(await login(path, next), 'https://app.test');
					expect(went.origin).toBe('https://app.test');
					expect(went.pathname.startsWith(path)).toBe(true);
				}
			),
			{ numRuns: 300 }
		);
		expect(await login('/__profiler', '/__profiler/report/r1')).toBe(
			'/__profiler/report/r1?og-after-login=1'
		);
	});
});
