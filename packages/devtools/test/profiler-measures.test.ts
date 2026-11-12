// THE PROFILER VOUCHES ONLY FOR ITS LOGGED-IN USER (the shared `measures` hook: core's
// `server-timing` on region answers). The beacon flag cookie carries no secret, so anyone can set it;
// only a session cookie that matches the profiler's key makes a visitor one it measures for.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { profiler } from '../src/profiler/index.ts';

const dev_switch = vi.hoisted(() => ({ dev: true }));
vi.mock('../src/profiler/env.ts', () => ({ detect_dev: () => dev_switch.dev }));

const SECRET = 'prof-key-long-enough';
const COOKIE_PAIR_RE = /^og_profiler=([^;]*)/;

function event(path: string, cookie: string | null, init: RequestInit = {}): RequestEvent {
	const url = new URL(`http://localhost${path}`);
	const headers = new Headers(init.headers);
	if (cookie != null) headers.set('cookie', cookie);
	const jar = Object.fromEntries(
		(cookie ?? '')
			.split('; ')
			.filter(Boolean)
			.map((p) => [p.slice(0, p.indexOf('=')), p.slice(p.indexOf('=') + 1)])
	);
	return {
		url,
		request: new Request(url, { ...init, headers }),
		route: { id: null },
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

/** A production profiler, and a login that returns its session and the flag the next page sets. */
function logged_in() {
	dev_switch.dev = false;
	const handle = profiler({ secret: SECRET });
	const run = {
		handle: (e: RequestEvent) => handle({ event: e, resolve: async () => new Response('app') }),
		measures: (e: RequestEvent) => handle.measures(e)
	};
	async function login_flag(): Promise<{ token: string; flag: string }> {
		const login = await run.handle(
			event('/__profiler/login', null, {
				method: 'POST',
				body: JSON.stringify({ key: SECRET, next: '/__profiler' })
			})
		);
		const token = COOKIE_PAIR_RE.exec(
			login.headers.getSetCookie().find((c) => c.startsWith('og_profiler='))!
		)![1]!;
		const page = await run.handle(event('/__profiler', `og_profiler=${token}`));
		const flag = /^og_profiler_beacon=([^;]*)/.exec(
			page.headers.getSetCookie().find((c) => c.startsWith('og_profiler_beacon='))!
		)![1]!;
		return { token, flag };
	}
	return { run, login_flag };
}

afterEach(() => {
	dev_switch.dev = true;
	vi.useRealTimers();
});

describe('profiler: measures', () => {
	it('the beacon flag alone is not the profiler’s user', async () => {
		dev_switch.dev = false;
		const handle = profiler({ secret: SECRET });
		expect(await handle.measures(event('/', 'og_profiler_beacon=1'))).toBe(false);
		expect(await handle.measures(event('/', 'og_profiler_beacon=1; og_profiler=forged'))).toBe(
			false
		);
	});

	it('a logged-in browser measures with the site-wide flag alone (its session stays on the profiler path)', async () => {
		dev_switch.dev = false;
		const handle = profiler({ secret: SECRET });
		const run = (e: RequestEvent) => handle({ event: e, resolve: async () => new Response('app') });
		const login = await run(
			event('/__profiler/login', null, {
				method: 'POST',
				body: JSON.stringify({ key: SECRET, next: '/__profiler' })
			})
		);
		const token = COOKIE_PAIR_RE.exec(
			login.headers.getSetCookie().find((c) => c.startsWith('og_profiler='))!
		)![1];
		// the next profiler page sets the flag (Path=/): the only profiler cookie a region request carries
		const page = await run(event('/__profiler', `og_profiler=${token}`));
		const flag = /^og_profiler_beacon=([^;]*)/.exec(
			page.headers.getSetCookie().find((c) => c.startsWith('og_profiler_beacon='))!
		)![1]!;
		expect(flag).not.toBe('');
		expect(await handle.measures(event('/__ogygia__', `og_profiler_beacon=${flag}`))).toBe(true);
		expect(await handle.measures(event('/__ogygia__', 'og_profiler_beacon=1'))).toBe(false);
	});

	it('logout ends the flag with its session; another session’s flag stays', async () => {
		const { run, login_flag } = logged_in();
		const mine = await login_flag();
		const other = await login_flag();
		expect(await run.measures(event('/__ogygia__', `og_profiler_beacon=${mine.flag}`))).toBe(true);
		await run.handle(event('/__profiler/logout', `og_profiler=${mine.token}`));
		expect(await run.measures(event('/__ogygia__', `og_profiler_beacon=${mine.flag}`))).toBe(false);
		expect(await run.measures(event('/__ogygia__', `og_profiler_beacon=${other.flag}`))).toBe(true);
	});

	it('the flag ends when its session would have', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		const { run, login_flag } = logged_in();
		const { flag } = await login_flag();
		expect(await run.measures(event('/__ogygia__', `og_profiler_beacon=${flag}`))).toBe(true);
		vi.setSystemTime(Date.now() + 13 * 60 * 60 * 1000);
		expect(await run.measures(event('/__ogygia__', `og_profiler_beacon=${flag}`))).toBe(false);
	});

	it('a flag with any part changed is not', async () => {
		const { run, login_flag } = logged_in();
		const { flag } = await login_flag();
		const parts = flag.split('.');
		for (let i = 0; i < parts.length; i++) {
			const changed = [...parts];
			changed[i] = changed[i]!.slice(0, -1) + (changed[i]!.endsWith('0') ? '1' : '0');
			expect(await run.measures(event('/', `og_profiler_beacon=${changed.join('.')}`))).toBe(false);
		}
	});

	it('the old flag, one value per secret for every browser, is not', async () => {
		dev_switch.dev = false;
		const { createHmac } = await import('node:crypto');
		const old = createHmac('sha256', SECRET).update('og-profiler-beacon-flag').digest('hex');
		const handle = profiler({ secret: SECRET });
		expect(await handle.measures(event('/', `og_profiler_beacon=${old}`))).toBe(false);
	});

	it('a flag of 64 characters but more bytes (a decoded %C3%A9 each) is refused, not thrown', async () => {
		dev_switch.dev = false;
		const handle = profiler({ secret: SECRET });
		await expect(handle.measures(event('/', `og_profiler_beacon=${'é'.repeat(64)}`))).resolves.toBe(
			false
		);
	});

	it('a flag signed under another secret is not', async () => {
		dev_switch.dev = false;
		const { createHmac } = await import('node:crypto');
		const other = createHmac('sha256', `${SECRET}-other`)
			.update('og-profiler-beacon-flag')
			.digest('hex');
		const handle = profiler({ secret: SECRET });
		expect(await handle.measures(event('/', `og_profiler_beacon=${other}`))).toBe(false);
	});
});
