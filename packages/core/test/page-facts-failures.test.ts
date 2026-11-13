/**
 * THE PAGE'S FACTS WHEN THE ANSWER FAILS (server/page-facts.ts). Kit's data request can fail at
 * every step: the fetch, the status, the body, its first line, a node's decode, the route header, a
 * streamed chunk, the stream itself, and the source's own cancel. Each is a reason (`miss`) or a
 * promise rejected with its code, never a throw, and nothing is left as an unhandled rejection.
 */
import { afterEach, expect, it } from 'vitest';
import * as devalue from 'devalue';
import { scope } from '@ogygia/machine';
import { look_up_page, PAGE_FACTS_ROUTE_HEADER } from '../src/server/page-facts.ts';

const AT = new URL('https://a.test/x');
const bytes = (s: string) => new TextEncoder().encode(s);
const later = (ms: number) => new Promise((r) => setTimeout(r, ms));

const unhandled: unknown[] = [];
const on_unhandled = (reason: unknown) => void unhandled.push(reason);
process.on('unhandledRejection', on_unhandled);
afterEach(() => {
	unhandled.length = 0;
});

/** Kit's `data` line, with one streamed promise (id 1) under `slow` when `promise`. */
function data_line(promise = false): string {
	const flat = promise ? [{ slow: 1 }, ['Promise', 2], 1] : [{ a: 1 }, 1];
	return `${JSON.stringify({ type: 'data', nodes: [{ type: 'data', data: flat }] })}\n`;
}

/** A body of `lines`, then open (`hold`), closed, or broken once they were read; its cancel throws
 *  when `bad_cancel`. */
function body(
	lines: string[],
	o: { end?: 'close' | 'error' | 'hold'; bad_cancel?: boolean } = {}
): ReadableStream<Uint8Array> {
	return new ReadableStream<Uint8Array>({
		start(c) {
			for (const l of lines) c.enqueue(bytes(l));
			if (o.end === 'close' || o.end === undefined) c.close();
			else if (o.end === 'error') setTimeout(() => c.error(new Error('the answer broke')), 5);
		},
		cancel() {
			if (o.bad_cancel) throw new Error('a source that cannot be cancelled');
		}
	});
}

const fetching =
	(stream: ReadableStream<Uint8Array>, init: ResponseInit = {}) =>
	async () =>
		new Response(stream, init);

it('a data request that throws is a miss that says why', async () => {
	const facts = await look_up_page(AT, async () => Promise.reject(new Error('offline')), {});
	expect(facts).toEqual({ miss: 'the data request failed (offline)' });
});

it('an answer that is not ok is not read, and a source that cannot be cancelled leaves nothing unhandled', async () => {
	const facts = await look_up_page(
		AT,
		fetching(body([data_line()], { end: 'hold', bad_cancel: true }), { status: 503 }),
		{}
	);
	expect(facts).toEqual({ miss: 'the data request answered 503' });
	await later(10);
	expect(unhandled).toEqual([]);
});

it('an ok answer with no body is a miss, not a read of nothing', async () => {
	const facts = await look_up_page(AT, async () => new Response(null, { status: 200 }), {});
	expect(facts).toEqual({ miss: 'the data request answered 200' });
});

it('a first line that is not JSON stops the read, and a failed cancel leaves nothing unhandled', async () => {
	const facts = await look_up_page(
		AT,
		fetching(body(['<!doctype html>\n'], { end: 'hold', bad_cancel: true })),
		{}
	);
	expect(facts).toEqual({ miss: 'the answer is not Kit data' });
	await later(10);
	expect(unhandled).toEqual([]);
});

it('a node that does not decode is a miss that says why', async () => {
	const flat = [{ x: 1 }, ['Odd', 2], 1];
	const line = `${JSON.stringify({ type: 'data', nodes: [{ type: 'data', data: flat }] })}\n`;
	const facts = await look_up_page(AT, fetching(body([line])), {
		Odd: () => {
			throw new Error('a decoder that throws');
		}
	});
	expect(facts).toEqual({ miss: 'its data did not decode (a decoder that throws)' });
});

it('a whole answer with no promise is let go, and a failed cancel leaves nothing unhandled', async () => {
	const facts = await look_up_page(
		AT,
		fetching(body([data_line()], { end: 'hold', bad_cancel: true })),
		{}
	);
	expect(facts).toMatchObject({ data: { a: 1 } });
	await later(10);
	expect(unhandled).toEqual([]);
});

it('a mangled route header leaves the page with no route, and its data', async () => {
	const facts = await look_up_page(
		AT,
		fetching(body([data_line()]), { headers: { [PAGE_FACTS_ROUTE_HEADER]: '%7Bnot json' } }),
		{}
	);
	expect(facts).toMatchObject({ route: { id: null }, params: {}, data: { a: 1 } });
});

it('a chunk line that does not decode leaves its promise to the answer’s end, which rejects it, coded', async () => {
	const facts = await look_up_page(
		AT,
		fetching(body([data_line(true), '{"type":"chunk","id":1,"data":\n'])),
		{}
	);
	if (!('data' in facts)) throw new Error('no facts');
	await expect(facts.data.slow).rejects.toMatchObject({ code: 'page_promise_unresolved' });
	expect(unhandled).toEqual([]);
});

it('a stream that breaks rejects what did not arrive, coded, and a failed cancel leaves nothing unhandled', async () => {
	const facts = await look_up_page(
		AT,
		fetching(body([data_line(true)], { end: 'error', bad_cancel: true })),
		{}
	);
	if (!('data' in facts)) throw new Error('no facts');
	await expect(facts.data.slow).rejects.toMatchObject({ code: 'page_promise_unresolved' });
	await later(10);
	expect(unhandled).toEqual([]);
});

it('a streamed promise nobody awaits, rejected at the answer’s end, leaves nothing unhandled', async () => {
	await look_up_page(AT, fetching(body([data_line(true)])), {});
	await later(10);
	expect(unhandled).toEqual([]);
});

it('a chunk that came still resolves its promise after a line that did not decode', async () => {
	const chunk = JSON.stringify({
		type: 'chunk',
		id: 1,
		data: JSON.parse(devalue.stringify('late'))
	});
	const facts = await look_up_page(
		AT,
		fetching(body([data_line(true), 'not json\n', `${chunk}\n`])),
		{}
	);
	if (!('data' in facts)) throw new Error('no facts');
	await expect(facts.data.slow).resolves.toBe('late');
});

it('the request ending stops the read, and a failed cancel leaves nothing unhandled', async () => {
	const request = scope();
	const facts = await look_up_page(
		AT,
		fetching(body([data_line(true)], { end: 'hold', bad_cancel: true })),
		{},
		request
	);
	if (!('data' in facts)) throw new Error('no facts');
	request.close();
	await expect(facts.data.slow).rejects.toMatchObject({ code: 'page_promise_unresolved' });
	await later(10);
	expect(unhandled).toEqual([]);
});
