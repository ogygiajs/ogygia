/**
 * THE REQUEST END (plugin/server.ts `end_request`, #243): a plugin's `done` may return work that
 * must finish (a sink's send). Where the platform keeps a request alive past its response
 * (`waitUntil`), the work is handed to it. Elsewhere it runs on by itself: a long-running server
 * keeps it alive in the process, and the visitor's response is never held for it. Real streams,
 * real timers.
 */
import { describe, expect, it } from 'vitest';
import { end_request, type LivePlugin } from '../src/plugin/server.ts';
import type { RequestContext, ServerApp, ServerPlugin } from '../src/plugin/index.ts';

const live = (def: ServerPlugin<unknown, unknown>): LivePlugin => ({
	def,
	app: { name: 'p', options: undefined } as unknown as ServerApp<unknown>
});
const ctx = {} as RequestContext<unknown, unknown>;

/** A plugin whose `done` leaves `ms` of work running; `finished` says when it ended. */
function sender(ms: number) {
	const seen = { finished: false };
	const plugin = live({
		done: () =>
			new Promise<void>((r) =>
				setTimeout(() => {
					seen.finished = true;
					r();
				}, ms)
			)
	});
	return { plugin, seen };
}

/** The request's end, then what goes out: the response as the route made it. */
async function end(
	plugins: LivePlugin[],
	platform: unknown,
	response: Response | null
): Promise<Response | null> {
	end_request(
		plugins,
		plugins.map(() => ctx),
		platform
	);
	return response;
}

describe('end_request: the work a plugin leaves at the request end', () => {
	it("the platform's waitUntil (platform.context) gets it, and the response does not wait", async () => {
		const s = sender(200);
		const handed: Promise<unknown>[] = [];
		const platform = { context: { waitUntil: (p: Promise<unknown>) => void handed.push(p) } };
		const out = await end([s.plugin], platform, new Response('page'));
		expect(await out!.text()).toBe('page');
		expect(s.seen.finished).toBe(false); // the whole body came before the 200 ms send ended
		expect(handed).toHaveLength(1);
		await handed[0];
		expect(s.seen.finished).toBe(true);
	});

	it('platform.ctx.waitUntil is the same path', async () => {
		const s = sender(20);
		const handed: Promise<unknown>[] = [];
		const platform = { ctx: { waitUntil: (p: Promise<unknown>) => void handed.push(p) } };
		await end([s.plugin], platform, new Response('page'));
		expect(handed).toHaveLength(1);
		await handed[0];
		expect(s.seen.finished).toBe(true);
	});

	it('no waitUntil: the response is never held for the work, its body ends before a slow send', async () => {
		const s = sender(200);
		const response = new Response('page', { status: 201 });
		const out = await end([s.plugin], undefined, response);
		expect(out).toBe(response); // the visitor's response, as it was
		expect(await out!.text()).toBe('page');
		expect(s.seen.finished).toBe(false); // the whole body came before the 200 ms send ended …
		await new Promise((r) => setTimeout(r, 250));
		expect(s.seen.finished).toBe(true); // … which runs on by itself in the process
	});

	it('no waitUntil and a response with no body, or a request that threw: nothing waits either', async () => {
		const s = sender(200);
		const response = new Response(null, { status: 304 });
		expect(await end([s.plugin], undefined, response)).toBe(response);
		expect(await end([s.plugin], undefined, null)).toBe(null);
		expect(s.seen.finished).toBe(false);
	});

	it('work that fails never fails the response, and a throwing done does not stop the next', async () => {
		const s = sender(10);
		const plugins = [
			live({
				done: () => {
					throw new Error('tail broke');
				}
			}),
			live({ done: () => Promise.reject(new Error('send broke')) }),
			s.plugin
		];
		const out = await end(plugins, undefined, new Response('page'));
		expect(await out!.text()).toBe('page');
		await new Promise((r) => setTimeout(r, 30)); // (a rejection left unhandled is reported by now)
		expect(s.seen.finished).toBe(true);
	});

	it('no work left: nothing is handed to the platform', () => {
		const handed: Promise<unknown>[] = [];
		const platform = { context: { waitUntil: (p: Promise<unknown>) => void handed.push(p) } };
		end_request([live({ done: () => {} }), live({})], [ctx, ctx], platform);
		expect(handed).toEqual([]);
	});
});
