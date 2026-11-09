/**
 * THE EXPOSURE QUEUE (#243): exposures buffer, then go to the sink in a batch (at `max`, after `ms`,
 * or at the request's end). A sink is usually a network send: it can reject, and it takes time. A
 * rejecting sink must never be an unhandled rejection (Node exits on one by default), and the
 * request's end must wait for the send, or a serverless instance freezes with it cut off. Real
 * timers, a real async sink.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startPlugin } from '@ogygia/core/plugin/testing';
import server from '../src/server.ts';
import { decide, flag, type ExposureEvent } from '../src/index.ts';

const { ctx } = startPlugin(server, { name: '@ogygia/flags' });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let n = 0;
/** A request read by a fresh visitor (each read is a new exposure). */
function read(f: (c: { request: Request; url: URL; visitor: { sub: string } }) => unknown) {
	const request = new Request('http://x/');
	f({ request, url: new URL(request.url), visitor: { sub: `v${++n}` } });
	return ctx(request);
}

afterEach(() => {
	decide({ exposure: undefined, batch: { max: 25, ms: 2000 } });
	vi.restoreAllMocks();
});

describe('the exposure queue', () => {
	it('a sink that rejects is contained: no unhandled rejection, and a warning with its code', async () => {
		const unhandled: unknown[] = [];
		const on_unhandled = (reason: unknown) => unhandled.push(reason);
		process.on('unhandledRejection', on_unhandled);
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const f = flag('queue-rejects', 100);
			decide({
				exposure: async () => {
					await sleep(5);
					throw new Error('pipeline down');
				},
				batch: { max: 100, ms: 60_000 }
			});
			await server.done!(read(f));
			await sleep(20); // (an unhandled rejection is reported after the microtasks run out)
			expect(unhandled).toEqual([]);
			expect(warn.mock.calls.flat().join(' ')).toContain('flags_exposure_failed');
		} finally {
			process.off('unhandledRejection', on_unhandled);
		}
	});

	it("the request's end resolves after the sink's send", async () => {
		const f = flag('queue-waits', 100);
		const sent: string[] = [];
		decide({
			exposure: async (events) => {
				await sleep(30);
				sent.push(...events.map((e) => e.name));
			},
			batch: { max: 100, ms: 60_000 }
		});
		const done = server.done!(read(f));
		expect(sent).toEqual([]);
		await done;
		expect(sent).toEqual(['queue-waits']);
	});

	it('an exposure read while a send is in flight goes in the next send, and that end waits for it', async () => {
		const f = flag('queue-next', 100);
		const batches: ExposureEvent[][] = [];
		let in_flight = 0;
		let most = 0;
		decide({
			exposure: async (events) => {
				most = Math.max(most, ++in_flight);
				await sleep(20);
				batches.push(events);
				in_flight--;
			},
			batch: { max: 100, ms: 60_000 }
		});
		const first = server.done!(read(f)); // a send starts
		const second = server.done!(read(f)); // read while it is in flight
		await second;
		expect(batches.map((b) => b.length)).toEqual([1, 1]);
		expect(most).toBe(1); // one send at a time
		await first;
	});

	it('the age cap sends a buffered batch on its own', async () => {
		const f = flag('queue-age', 100);
		const batches: ExposureEvent[][] = [];
		decide({ exposure: (events) => void batches.push(events), batch: { max: 100, ms: 20 } });
		read(f);
		read(f);
		expect(batches).toEqual([]);
		await sleep(50);
		expect(batches.map((b) => b.length)).toEqual([2]);
	});

	it('nothing buffered: the end has nothing to wait for', () => {
		decide({ exposure: () => {}, batch: { max: 100, ms: 60_000 } });
		expect(server.done!(ctx(new Request('http://x/')))).toBeUndefined();
	});
});
