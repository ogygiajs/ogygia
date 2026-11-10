/**
 * The devtools server half mounts ONE profiler per process (#242): the first requests that arrive
 * together share one mount, and a mount whose import failed is not kept, so the next request tries
 * again. Each test loads a fresh copy of the server half and sends it real concurrent requests: the
 * profiler's own import is what they race over.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import type { ServerApp } from '@ogygia/core/plugin';
import type { DevtoolsServerOptions } from '../src/server.ts';

const dev_switch = vi.hoisted(() => ({ dev: true }));
vi.mock('../src/profiler/env.ts', () => ({ detect_dev: () => dev_switch.dev }));

const LIVE = Symbol.for('ogygia.profiler.live');
const slot = globalThis as Record<symbol, unknown>;

/** Every profiler made while the test runs: each one names itself the process's live profiler. */
let made: unknown[] = [];
beforeEach(() => {
	made = [];
	vi.resetModules();
	Object.defineProperty(globalThis, LIVE, {
		configurable: true,
		get: () => made.at(-1),
		set: (p: unknown) => {
			made.push(p);
		}
	});
});
afterEach(() => {
	vi.doUnmock('../src/profiler/index.ts');
	delete slot[LIVE];
});

function make_event(path: string): RequestEvent {
	const url = new URL(`http://localhost${path}`);
	return {
		url,
		request: new Request(url),
		route: { id: '/[slug]' },
		cookies: {
			get: () => undefined,
			set: () => {},
			delete: () => {},
			getAll: () => [],
			serialize: () => ''
		},
		fetch: async () => new Response('<html><body>ok</body></html>')
	} as unknown as RequestEvent;
}

const options: DevtoolsServerOptions = { profiler: { secret: 'k' } };

async function fresh_server() {
	const { default: server } = await import('../src/server.ts');
	const app = { options } as unknown as ServerApp<DevtoolsServerOptions>;
	return (path: string) =>
		server.handle!(
			{ event: make_event(path), options, app },
			async () => new Response('<html><body>page</body></html>')
		);
}

describe('the profiler mount', () => {
	it('two first requests at once mount one profiler', async () => {
		const request = await fresh_server();
		const answers = await Promise.all([request('/a'), request('/b')]);
		for (const r of answers) expect(r.status).toBe(200);
		expect(made).toHaveLength(1);
		// and every request after goes to that one
		await request('/c');
		expect(made).toHaveLength(1);
	}, 30_000);

	it('a mount whose import failed is tried again by the next request', async () => {
		let failures = 1;
		vi.doMock('../src/profiler/index.ts', async (actual) => {
			if (failures-- > 0) throw new Error('a dev server mid-edit');
			return actual();
		});
		const request = await fresh_server();
		// the first request has no profiler, and is still answered
		expect((await request('/a')).status).toBe(200);
		expect(made).toHaveLength(0);
		// the next one mounts it
		expect((await request('/b')).status).toBe(200);
		expect(made).toHaveLength(1);
	}, 30_000);

	// A profiler that cannot mount (an edge runtime without node:inspector, a profiler module that
	// throws) leaves every request unprofiled: that is said, once for the process, with the error.
	it('a mount that fails is said once, with its error', async () => {
		const errors: unknown[][] = [];
		const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
			errors.push(a);
		});
		vi.doMock('../src/profiler/index.ts', async () => {
			throw new Error('no node:inspector here');
		});
		try {
			const request = await fresh_server();
			expect((await request('/a')).status).toBe(200);
			expect((await request('/b')).status).toBe(200);
			const said = errors.filter((a) => String(a[0]).includes('devtools_profiler_mount_failed'));
			expect(said).toHaveLength(1);
			// (the test runner wraps a module that failed to load: the error is its cause)
			const error = said[0][1] as Error;
			expect(String(error.cause ?? error)).toContain('no node:inspector here');
		} finally {
			spy.mockRestore();
		}
	}, 30_000);
});
