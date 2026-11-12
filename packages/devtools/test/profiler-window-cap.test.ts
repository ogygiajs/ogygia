/**
 * A window nobody stops ends at its cap (#196). When its capture then fails (the inspector refused
 * to stop the profile), that failure is the window's own: nothing is left unhandled.
 */
import { afterEach, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { profiler } from '../src/profiler/index.ts';
import { span_recording } from '../src/profiler/span.ts';

vi.mock('../src/profiler/env.ts', () => ({ detect_dev: () => true }));
// an inspector whose profile cannot be stopped (another debugger took the session over)
vi.mock('node:inspector/promises', () => ({
	Session: class {
		connect(): void {}
		disconnect(): void {}
		async post(method: string): Promise<object> {
			if (method === 'Profiler.stop') throw new Error('the profile was stopped elsewhere');
			return {};
		}
	}
}));

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

afterEach(() => {
	vi.useRealTimers();
});

it('a window that reaches its cap and then fails to stop leaves no unhandled rejection, and frees the recorder', async () => {
	const unhandled: unknown[] = [];
	const on_unhandled = (reason: unknown) => unhandled.push(reason);
	process.on('unhandledRejection', on_unhandled);
	try {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		const handle = profiler({ secret: 'k' });
		const res = await handle({
			event: event('/__profiler/window/start', 'POST'),
			resolve: async () => new Response('no')
		});
		expect(res.status).toBe(200);
		// the capture is under way (its span recorder is in), then the clock passes the cap (a minute)
		while (!span_recording()) await new Promise((r) => setImmediate(r));
		await vi.advanceTimersByTimeAsync(61_000);
		vi.useRealTimers();
		await new Promise((r) => setTimeout(r, 100));
		expect(unhandled).toEqual([]);
		const again = await handle({
			event: event('/__profiler/window/start', 'POST'),
			resolve: async () => new Response('no')
		});
		expect(again.status).toBe(200);
	} finally {
		process.off('unhandledRejection', on_unhandled);
	}
}, 30_000);
