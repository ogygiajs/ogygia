/**
 * The recorder has one owner at a time (#196): a reset, a second stop or a second profiler in the
 * process never lets an old recording's end free, or switch off, what a newer recording holds.
 * Each test drives the real profiler handle with a real inspector session.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { profiler } from '../src/profiler/index.ts';
import { span_recording } from '../src/profiler/span.ts';
import { MemoryStore, type ProfilerStore } from '../src/profiler/storage/index.ts';

const dev_switch = vi.hoisted(() => ({ dev: true }));
/** a production profiler's secret (at least 16 bytes) */
const KEY = 'prof-key-of-16-bytes-or-more';
vi.mock('../src/profiler/env.ts', () => ({ detect_dev: () => dev_switch.dev }));

type Handle = ReturnType<typeof profiler>;

function make_event(
	path: string,
	init: { method?: string; headers?: Record<string, string>; fetch?: typeof fetch } = {}
): RequestEvent {
	const url = new URL(`http://localhost${path}`);
	return {
		url,
		request: new Request(url, { method: init.method ?? 'GET', headers: init.headers ?? {} }),
		route: { id: path.startsWith('/__profiler') ? null : '/[slug]' },
		cookies: {
			get: () => undefined,
			set: () => {},
			delete: () => {},
			getAll: () => [],
			serialize: () => ''
		},
		fetch: init.fetch ?? (async () => new Response('<html><body>ok</body></html>'))
	} as unknown as RequestEvent;
}

const call = async (
	handle: Handle,
	path: string,
	init?: { method?: string; headers?: Record<string, string>; fetch?: typeof fetch }
): Promise<Response> =>
	handle({ event: make_event(path, init), resolve: async () => new Response('no') });

const page = (handle: Handle, render?: typeof globalThis.fetch) =>
	call(handle, '/__profiler/page?p=/p&runs=1&cold=0', { fetch: render });

const gate = () => {
	let open!: () => void;
	const opened = new Promise<void>((r) => (open = r));
	return { open, opened };
};

/** the network layer's one switch for every copy of its module (net.ts) */
const net_state = () =>
	(globalThis as Record<symbol, { stacks: boolean } | undefined>)[
		Symbol.for('ogygia.profiler.net-state')
	];

const stops: (() => Promise<unknown>)[] = [];
afterEach(async () => {
	for (const stop of stops.splice(0)) await stop();
	dev_switch.dev = true;
});

describe('the recorder has one owner', () => {
	it('a reset during a page profile: that profile ending leaves the window started after the reset recording', async () => {
		const handle = profiler({ secret: 'k' });
		const entered = gate();
		const held = gate();
		const old = page(handle, (async () => {
			entered.open();
			await held.opened;
			return new Response('<html><body>slow</body></html>');
		}) as typeof fetch);
		await entered.opened;
		await call(handle, '/__profiler/reset');
		const start = await call(handle, '/__profiler/window/start', { method: 'POST' });
		expect(start.status).toBe(200);
		const { id } = await start.json();
		stops.push(() =>
			call(handle, '/__profiler/window/stop', { method: 'POST', headers: { 'x-og-window': id } })
		);
		held.open();
		await old.catch(() => undefined);
		// the window still records its spans, and still holds the recorder
		expect(span_recording()).toBe(true);
		expect((await page(handle)).status).toBe(409);
	}, 30_000);

	it('a reset during a window clears it: a page profile after it attributes each of its renders', async () => {
		dev_switch.dev = false;
		const orig = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response('data', { headers: { 'content-length': '4' } })) as typeof fetch;
		try {
			const handle = profiler({ secret: KEY, serverTiming: true });
			const key = { 'x-profiler-key': KEY };
			expect(
				(await call(handle, '/__profiler/window/start', { method: 'POST', headers: key })).status
			).toBe(200);
			await call(handle, '/__profiler/reset', { headers: key });
			const timings: string[] = [];
			// the page's renders go through the app's handle, as Kit's event.fetch does
			const render = (async (p: string, init?: RequestInit) => {
				const res = await handle({
					event: make_event(String(p), { headers: Object.fromEntries(new Headers(init?.headers)) }),
					resolve: async () => {
						await fetch('https://api.example.com/data');
						return new Response('<html><body>page</body></html>');
					}
				});
				timings.push(res.headers.get('Server-Timing') ?? '');
				return res;
			}) as typeof fetch;
			const res = await call(handle, '/__profiler/page?p=/p&runs=1&cold=0', {
				headers: key,
				fetch: render
			});
			expect(res.status).toBeLessThan(400);
			expect(timings.length).toBeGreaterThan(0);
			// every render ran inside the request context: its call was timed as the request's own
			for (const t of timings) expect(t).toContain('net;');
		} finally {
			globalThis.fetch = orig;
		}
	}, 30_000);

	it('a second stop of a window that is still finishing its report never ends the next window', async () => {
		// the store's visit rows: the first read answers at once, the second waits until let go
		const second = gate();
		let reads = 0;
		const memory = new MemoryStore();
		const store: ProfilerStore = {
			kind: 'memory',
			putReport: (r) => memory.putReport(r),
			getReport: (id) => memory.getReport(id),
			listReports: (limit) => memory.listReports(limit),
			deleteReport: (id) => memory.deleteReport(id),
			putVisit: (v) => memory.putVisit(v),
			listVisits: async (page, limit) => {
				if (++reads === 2) await second.opened;
				return memory.listVisits(page, limit);
			}
		};
		const handle = profiler({ secret: 'k', store });
		const start = await (await call(handle, '/__profiler/window/start', { method: 'POST' })).json();
		const tag = { 'x-og-window': start.id };
		const first_stop = call(handle, '/__profiler/window/stop', { method: 'POST', headers: tag });
		const second_stop = call(handle, '/__profiler/window/stop', { method: 'POST', headers: tag });
		expect((await first_stop).status).toBe(200);
		// the next window starts while the second stop may still wait on the store
		const next = await call(handle, '/__profiler/window/start', { method: 'POST' });
		expect(next.status).toBe(200);
		const next_tag = { 'x-og-window': (await next.json()).id };
		second.open();
		expect((await second_stop).status).toBe(200);
		// the next window is still the one recording: no other starts, and it stops with its report
		expect((await call(handle, '/__profiler/window/start', { method: 'POST' })).status).toBe(409);
		expect(
			(await call(handle, '/__profiler/window/stop', { method: 'POST', headers: next_tag })).status
		).toBe(200);
	}, 30_000);

	it("two profilers in one process (a dev server that re-ran the hooks): the first window to end keeps the other's spans", async () => {
		const older = profiler({ secret: 'k' });
		const newer = profiler({ secret: 'k' });
		const a = await (await call(older, '/__profiler/window/start', { method: 'POST' })).json();
		const b = await (await call(newer, '/__profiler/window/start', { method: 'POST' })).json();
		stops.push(() =>
			call(newer, '/__profiler/window/stop', { method: 'POST', headers: { 'x-og-window': b.id } })
		);
		// both captures under way (each puts its span recorder in a few steps after its start answers)
		await new Promise((r) => setTimeout(r, 200));
		expect(span_recording()).toBe(true);
		expect(
			(
				await call(older, '/__profiler/window/stop', {
					method: 'POST',
					headers: { 'x-og-window': a.id }
				})
			).status
		).toBe(200);
		expect(span_recording()).toBe(true);
	}, 30_000);

	it("two profilers in one process: the first page profile to end keeps the other's call stacks on", async () => {
		const older = profiler({ secret: 'k' });
		const newer = profiler({ secret: 'k' });
		const entered = gate();
		const held = gate();
		let stacks_after: boolean | undefined;
		let gated = false;
		const slow = page(older, (async () => {
			// the timed render (stacks are captured only inside the profiled window)
			if (net_state()?.stacks && !gated) {
				gated = true;
				entered.open();
				await held.opened;
				stacks_after = net_state()?.stacks;
			}
			return new Response('<html><body>slow</body></html>');
		}) as typeof fetch);
		await entered.opened;
		expect((await page(newer)).status).toBeLessThan(400);
		held.open();
		await slow;
		expect(stacks_after).toBe(true);
	}, 60_000);

	it("a recording wedged past the hard cap is cut: the site's requests stop paying for its context", async () => {
		dev_switch.dev = false;
		const orig = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response('data', { headers: { 'content-length': '4' } })) as typeof fetch;
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		try {
			const handle = profiler({ secret: KEY, serverTiming: true });
			const visitor = async () =>
				(
					await handle({
						event: make_event('/visitor'),
						resolve: async () => {
							await fetch('https://api.example.com/data');
							return new Response('page');
						}
					})
				).headers.get('Server-Timing') ?? '';
			// a header-profiled request whose page never answers
			const held = gate();
			const wedged = handle({
				event: make_event('/wedged', { headers: { 'x-profile': KEY } }),
				resolve: async () => {
					await held.opened;
					return new Response('late');
				}
			});
			while (!span_recording()) await new Promise((r) => setImmediate(r));
			// while it records, every request is attributed
			expect(await visitor()).toContain('net;');
			// past the hard cap (30 s, and 2 more)
			await vi.advanceTimersByTimeAsync(33_000);
			expect(await visitor()).not.toContain('net;');
			held.open();
			await wedged;
		} finally {
			vi.useRealTimers();
			globalThis.fetch = orig;
		}
	}, 30_000);
});
