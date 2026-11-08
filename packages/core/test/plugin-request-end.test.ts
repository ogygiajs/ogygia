/**
 * THE REQUEST END (plugin/server.ts `end_request`, #243): a plugin's `done` may return work that
 * must finish (a sink's send). Where the platform keeps a request alive past its response
 * (`waitUntil`), the work is handed to it and the response does not wait; elsewhere (a serverless
 * instance freezes once its response ends) the response's body ends only after the work. Real
 * streams, real timers.
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

/** Kept by `end_request`, or the response as it was. */
async function end(
	plugins: LivePlugin[],
	platform: unknown,
	response: Response | null
): Promise<Response | null> {
	const kept = end_request(
		plugins,
		plugins.map(() => ctx),
		platform,
		response
	);
	return kept === null ? response : await kept;
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

	it("no waitUntil: the response's body ends only after the work (an instance freezes at its end)", async () => {
		const s = sender(40);
		const out = await end([s.plugin], undefined, new Response('page', { status: 201 }));
		expect(out!.status).toBe(201); // the head goes out at once …
		expect(s.seen.finished).toBe(false);
		expect(await out!.text()).toBe('page'); // … the body, whole, and ended after the send
		expect(s.seen.finished).toBe(true);
	});

	it('no waitUntil and a response with no body: answered after the work', async () => {
		const s = sender(20);
		const out = await end([s.plugin], undefined, new Response(null, { status: 304 }));
		expect(s.seen.finished).toBe(true);
		expect(out!.status).toBe(304);
	});

	it('a request that threw: the work is still waited for before the error goes on', async () => {
		const s = sender(20);
		expect(await end([s.plugin], undefined, null)).toBe(null);
		expect(s.seen.finished).toBe(true);
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
		expect(s.seen.finished).toBe(true);
	});

	it('no work left: the same response, untouched', () => {
		const response = new Response('page');
		const kept = end_request([live({ done: () => {} }), live({})], [ctx, ctx], undefined, response);
		expect(kept).toBe(null);
	});
});
