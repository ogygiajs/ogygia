/**
 * The trap and the always-on sampler when the inspector refuses (another debugger holds it, or the
 * host has none): the dashboard says what they caught and that they stopped, and a window started
 * after does not make a stopped trap look armed.
 */
import { afterEach, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { profiler } from '../src/profiler/index.ts';

vi.mock('../src/profiler/env.ts', () => ({ detect_dev: () => true }));
// the inspector refuses while `refuse` is on; the real one answers otherwise
const inspector = vi.hoisted(() => ({ refuse: true }));
vi.mock('node:inspector/promises', async (real) => {
	const actual = await real<typeof import('node:inspector/promises')>();
	class Session extends actual.Session {
		connect(): void {
			if (inspector.refuse) throw new Error('the inspector is held by another debugger');
			super.connect();
		}
	}
	return { ...actual, Session };
});

const event = (path: string, method = 'GET'): RequestEvent => {
	const url = new URL(`http://localhost${path}`);
	return {
		url,
		request: new Request(url, { method }),
		route: { id: null },
		cookies: {
			get: () => undefined,
			set: () => {},
			delete: () => {},
			getAll: () => [],
			serialize: () => ''
		},
		fetch: async () => new Response('ok')
	} as unknown as RequestEvent;
};

type Handle = ReturnType<typeof profiler>;
const call = (handle: Handle, path: string, method = 'GET') =>
	handle({ event: event(path, method), resolve: async () => new Response('ok') });
const dashboard = async (handle: Handle) =>
	(await (await call(handle, '/__profiler')).text()).replace(/\s+/g, ' ');

afterEach(() => {
	inspector.refuse = true;
});

it('a trap the inspector refused says it caught nothing and stopped', async () => {
	const handle = profiler({ secret: 'k', trap: { over: 30, window: 200, interval: 10, keep: 2 } });
	await call(handle, '/arm'); // the first request arms it: its first window opens ~1 s later
	await new Promise((r) => setTimeout(r, 1400));
	const dash = await dashboard(handle);
	expect(dash).toContain('Caught 0 of 2');
	expect(dash).toContain('the trap stopped');
	expect(dash).toContain('the inspector is held by another debugger');
}, 10_000);

it('a sampler the inspector refused says it stopped', async () => {
	const handle = profiler({ secret: 'k', sample: { every: 1, window: 100, interval: 10 } });
	await call(handle, '/arm');
	await new Promise((r) => setTimeout(r, 1400));
	const dash = await dashboard(handle);
	expect(dash).toContain('sampling stopped');
	expect(dash).toContain('the inspector is held by another debugger');
}, 10_000);

it('a window started after the trap stopped does not show the trap armed', async () => {
	const handle = profiler({ secret: 'k', trap: { over: 30, window: 200, interval: 10, keep: 2 } });
	await call(handle, '/arm');
	await new Promise((r) => setTimeout(r, 1400));
	inspector.refuse = false;
	const start = await call(handle, '/__profiler/window/start', 'POST');
	expect(start.status).toBe(200);
	const dash = await dashboard(handle);
	expect(dash).toMatch(/Catch the slow one:<\/b> stopped/);
	await call(handle, '/__profiler/window/stop', 'POST');
}, 10_000);
