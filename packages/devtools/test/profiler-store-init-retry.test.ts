/**
 * A durable store whose `init` fails once (the database unreachable for a moment at a cold start)
 * must not be dropped for the life of the process (#289): the next use of the store tries its init
 * again, and the report that use writes reaches the store. Driven through the real profiler handle,
 * with a real inspector session.
 */
import { expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { profiler } from '../src/profiler/index.ts';
import { MemoryStore, type ProfilerStore } from '../src/profiler/storage/index.ts';

vi.mock('../src/profiler/env.ts', () => ({ detect_dev: () => true }));

function make_event(
	path: string,
	init: { method?: string; headers?: Record<string, string> } = {}
) {
	const url = new URL(`http://localhost${path}`);
	return {
		url,
		request: new Request(url, { method: init.method ?? 'GET', headers: init.headers ?? {} }),
		route: { id: null },
		cookies: { get: () => undefined, set: () => {}, delete: () => {}, getAll: () => [] },
		fetch: async () => new Response('<html><body>ok</body></html>')
	} as unknown as RequestEvent;
}
const call = (
	handle: ReturnType<typeof profiler>,
	path: string,
	init?: { method?: string; headers?: Record<string, string> }
) => handle({ event: make_event(path, init), resolve: async () => new Response('no') });

it('a store whose init failed once is tried again by its next use, and the report reaches it', async () => {
	const memory = new MemoryStore();
	let inits = 0;
	const put = vi.fn((r: Parameters<MemoryStore['putReport']>[0]) => memory.putReport(r));
	const store: ProfilerStore = {
		kind: 'memory',
		init: async () => {
			if (++inits === 1) throw new Error('database unreachable');
		},
		putReport: put,
		getReport: (id) => memory.getReport(id),
		listReports: (limit) => memory.listReports(limit),
		deleteReport: (id) => memory.deleteReport(id)
	};
	const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
	try {
		const handle = profiler({ secret: 'k', store });
		// the mount's init fails
		await vi.waitFor(() => expect(inits).toBe(1));
		await new Promise((r) => setTimeout(r, 0));

		const start = await (await call(handle, '/__profiler/window/start', { method: 'POST' })).json();
		const stop = await call(handle, '/__profiler/window/stop', {
			method: 'POST',
			headers: { 'x-og-window': start.id }
		});
		expect(stop.status).toBe(200);
		await vi.waitFor(() => expect(put).toHaveBeenCalled());
		expect(inits).toBe(2);
		expect(await memory.listReports(10)).toHaveLength(1);
	} finally {
		errors.mockRestore();
	}
}, 30_000);
