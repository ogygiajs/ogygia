// THE PROFILER'S LOGIN in production: a secret long enough to guess at no rate, a bounded number of
// wrong keys per address, and a session cookie that is a random id the server signed (not a value
// derived from the secret): it expires, logout ends it, and a changed one is refused.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { profiler } from '../src/profiler/index.ts';

const dev_switch = vi.hoisted(() => ({ dev: true }));
vi.mock('../src/profiler/env.ts', () => ({ detect_dev: () => dev_switch.dev }));

const SECRET = 'a-profiler-secret-of-32-bytes-ok';
const COOKIE_PAIR_RE = /^og_profiler=([^;]*)/;

function event(
	path: string,
	o: { cookie?: string; ip?: string; init?: RequestInit } = {}
): RequestEvent {
	const url = new URL('http://localhost' + path);
	const headers = new Headers(o.init?.headers);
	if (o.cookie) headers.set('cookie', o.cookie);
	const jar = Object.fromEntries(
		(o.cookie ?? '')
			.split('; ')
			.filter(Boolean)
			.map((p) => [p.slice(0, p.indexOf('=')), p.slice(p.indexOf('=') + 1)])
	);
	return {
		url,
		request: new Request(url, { ...o.init, headers }),
		route: { id: null },
		getClientAddress: () => o.ip ?? '203.0.113.1',
		cookies: {
			get: (k: string) => jar[k],
			set() {},
			delete() {},
			getAll: () => [],
			serialize: () => ''
		},
		fetch: async () => new Response('ok')
	} as unknown as RequestEvent;
}

function prod(options: Parameters<typeof profiler>[0] = {}) {
	dev_switch.dev = false;
	const handle = profiler({ secret: SECRET, ...options });
	const run = (e: RequestEvent) => handle({ event: e, resolve: async () => new Response('app') });
	const login = (key: string, ip?: string) =>
		run(
			event('/__profiler/login', {
				ip,
				init: { method: 'POST', body: JSON.stringify({ key, next: '/__profiler' }) }
			})
		);
	const token_of = (res: Response) =>
		COOKIE_PAIR_RE.exec(res.headers.getSetCookie().find((c) => c.startsWith('og_profiler='))!)![1];
	/** a page behind the login: 200 when the session counts, a redirect to the login otherwise */
	const page = (token: string) =>
		run(event('/__profiler/run?p=/x&runs=1', { cookie: `og_profiler=${token}` }));
	return { handle, run, login, token_of, page };
}

afterEach(() => {
	dev_switch.dev = true;
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('profiler login: the secret', () => {
	it('a production secret shorter than 16 bytes opens nothing, and says why', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { login, run } = prod({ secret: 'short-key' });
		expect((await login('short-key')).headers.getSetCookie()).toEqual([]);
		// (the request goes on to the app: the profiler's own page never answers)
		const status = await run(
			event('/__profiler/status.json', { init: { headers: { 'x-profiler-key': 'short-key' } } })
		);
		expect(await status.text()).not.toContain('"recording"');
		expect(error.mock.calls.map((c) => String(c[0])).join('\n')).toContain(
			'devtools_profiler_secret_short'
		);
	});
});

describe('profiler login: wrong keys per address', () => {
	it('after ten wrong keys an address is refused, even with the right key; another address is not', async () => {
		const { login } = prod();
		for (let i = 0; i < 10; i++) expect((await login('wrong-' + i)).status).toBe(401);
		const refused = await login(SECRET);
		expect(refused.status).toBe(429);
		expect(refused.headers.getSetCookie()).toEqual([]);
		expect((await login(SECRET, '198.51.100.7')).status).toBe(200);
	});

	it('the right key spends nothing: a user who logs in often is never refused', async () => {
		const { login } = prod();
		for (let i = 0; i < 30; i++) expect((await login(SECRET)).status).toBe(200);
	});

	it('the x-profiler-key header shares the count', async () => {
		const { run, login } = prod();
		for (let i = 0; i < 10; i++)
			await run(
				event('/__profiler/status.json', { init: { headers: { 'x-profiler-key': 'nope' + i } } })
			);
		expect((await login(SECRET)).status).toBe(429);
	});
});

describe('profiler login: the session', () => {
	it('each login is a new random session, not a value the secret alone decides', async () => {
		const { login, token_of, page } = prod();
		const a = token_of(await login(SECRET));
		const b = token_of(await login(SECRET));
		expect(a).not.toBe(b);
		const { createHash } = await import('node:crypto');
		const old = createHash('sha256')
			.update('og-profiler:' + SECRET)
			.digest('hex');
		expect(a).not.toContain(old);
		expect((await page(old)).headers.get('location')).toMatch(/\/login/);
		expect((await page(a)).status).toBe(200);
		expect((await page(b)).status).toBe(200);
	});

	it('a session ends after its lifetime', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		const { login, token_of, page } = prod();
		const token = token_of(await login(SECRET));
		expect((await page(token)).status).toBe(200);
		vi.setSystemTime(Date.now() + 13 * 60 * 60 * 1000);
		expect((await page(token)).headers.get('location')).toMatch(/\/login/);
	});

	it('logout ends the session it carried; another session stays', async () => {
		const { login, token_of, page, run } = prod();
		const mine = token_of(await login(SECRET));
		const other = token_of(await login(SECRET));
		await run(event('/__profiler/logout', { cookie: `og_profiler=${mine}` }));
		expect((await page(mine)).headers.get('location')).toMatch(/\/login/);
		expect((await page(other)).status).toBe(200);
	});

	it('a session with any part changed is refused', async () => {
		const { login, token_of, page } = prod();
		const token = token_of(await login(SECRET));
		const parts = token.split('.');
		for (let i = 0; i < parts.length; i++) {
			const changed = [...parts];
			changed[i] = changed[i]!.slice(0, -1) + (changed[i]!.endsWith('0') ? '1' : '0');
			expect((await page(changed.join('.'))).headers.get('location')).toMatch(/\/login/);
		}
		// (a far expiry is no help: it is signed)
		const far = [...parts];
		far[2] = String(Number.MAX_SAFE_INTEGER);
		expect((await page(far.join('.'))).headers.get('location')).toMatch(/\/login/);
	});

	it('a session signed under another secret is refused', async () => {
		const a = prod();
		const token = a.token_of(await a.login(SECRET));
		const b = prod({ secret: SECRET + '-rotated' });
		expect((await b.page(token)).headers.get('location')).toMatch(/\/login/);
	});
});
