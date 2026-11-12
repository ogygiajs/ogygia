// The profiler's key check on a host with no `node:crypto` (an edge runtime): it hashes with Web
// Crypto and compares in constant time, so login still seats a session, the session cookie still
// opens the profiler, and a wrong key is still refused. Before, the check fell back to a plain `===`
// against the secret only (timing-dependent, and blind to the session cookie), and login threw.
import { afterEach, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { profiler } from '../src/profiler/index.ts';

const dev_switch = vi.hoisted(() => ({ dev: true }));
vi.mock('../src/profiler/env.ts', () => ({ detect_dev: () => dev_switch.dev }));
// (once the test starts, the host has no hashing in `node:crypto`: what the key check used throws)
const host = vi.hoisted(() => ({ no_node_crypto: false }));
vi.mock('node:crypto', async (real) => {
	const mod = await real<typeof import('node:crypto')>();
	const gone =
		<F extends (...a: never[]) => unknown>(f: F) =>
		(...a: Parameters<F>) => {
			if (host.no_node_crypto) throw new Error('no node:crypto on this host');
			return f(...a);
		};
	return {
		...mod,
		createHash: gone(mod.createHash),
		createHmac: gone(mod.createHmac),
		hkdfSync: gone(mod.hkdfSync),
		randomBytes: gone(mod.randomBytes),
		timingSafeEqual: gone(mod.timingSafeEqual)
	};
});

const SECRET = 'prof-key-of-16-bytes-or-more';

function event(path: string, init: RequestInit = {}, cookie?: string): RequestEvent {
	const url = new URL(`http://localhost${path}`);
	const headers = new Headers(init.headers);
	if (cookie) headers.set('cookie', `og_profiler=${cookie}`);
	return {
		url,
		request: new Request(url, { ...init, headers }),
		route: { id: null },
		cookies: {
			get: (k: string) => (k === 'og_profiler' ? cookie : undefined),
			set() {},
			delete() {},
			getAll: () => [],
			serialize: () => ''
		},
		fetch: async () => new Response('ok')
	} as unknown as RequestEvent;
}

afterEach(() => {
	dev_switch.dev = true;
	host.no_node_crypto = false;
});

it('with no node:crypto, login seats a session, the session opens the profiler, a wrong key is refused', async () => {
	dev_switch.dev = false;
	host.no_node_crypto = true;
	const handle = profiler({ secret: SECRET });
	const run = (e: RequestEvent) => handle({ event: e, resolve: async () => new Response('app') });
	const login = (key: string) =>
		run(
			event('/__profiler/login', {
				method: 'POST',
				body: JSON.stringify({ key, next: '/__profiler' })
			})
		);

	expect((await login('wrong')).status).toBe(401);
	const ok = await login(SECRET);
	expect(ok.status).toBe(200);
	const token = /^og_profiler=([^;]*)/.exec(
		ok.headers.getSetCookie().find((c) => c.startsWith('og_profiler='))!
	)![1];
	// (a signed session: `s1.<random id>.<expiry>.<MAC>`, made and checked with Web Crypto)
	expect(token).toMatch(/^s1\.[A-Za-z0-9_-]{24}\.\d{13}\.[0-9a-f]{64}$/);

	const opened = await run(event('/__profiler', {}, token));
	expect(opened.headers.get('location'), 'the session opens the profiler').toBeNull();
	const refused = await run(
		event(
			'/__profiler',
			{},
			token.replace(/.$/, (c) => (c === '0' ? '1' : '0'))
		)
	);
	expect(refused.headers.get('location'), 'a wrong session is sent to login').toContain(
		'/__profiler/login'
	);
	const by_header = await run(event('/__profiler', { headers: { 'x-profiler-key': SECRET } }));
	expect(by_header.headers.get('location')).toBeNull();
});
