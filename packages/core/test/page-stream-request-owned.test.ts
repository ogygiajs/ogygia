/**
 * A streamed load promise is the request's (#1305, server half): while the visitor is there it may
 * take as long as it takes; when the request ends (the visitor left, the body was cancelled) every
 * wait on it lets go, and the response closes. Dev says, once and coded, when one is still pending
 * after 10 s.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as devalue from 'devalue';
import { scope, STALE } from '@ogygia/machine';
import { settle_deferred, stream_page_deferred } from '../src/server/page-stream.ts';
import { look_up_page } from '../src/server/page-facts.ts';

const bytes = (s: string) => new TextEncoder().encode(s);
const later = <T>(value: T, ms: number) => new Promise<T>((r) => setTimeout(() => r(value), ms));
const never = () => new Promise<never>(() => {});

/** A Kit document that ends at `</body>` and closes. */
const kit_doc = () =>
	new Response(
		new ReadableStream<Uint8Array>({
			start(c) {
				c.enqueue(bytes('<html><body><p>page</p></body></html>'));
				c.close();
			}
		})
	);

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('a never-settling load promise is released when the client disconnects', () => {
	it('navigation stream: the response closes when the request ends', async () => {
		const request = scope();
		const res = stream_page_deferred(request, kit_doc(), [{ id: 0, promise: never() }], 1);
		const reader = res.body!.getReader();
		const first = await reader.read();
		expect(new TextDecoder().decode(first.value)).toContain('<p>page</p>');
		request.close();
		const next = await Promise.race([reader.read(), later('open' as const, 100)]);
		expect(next).not.toBe('open');
		expect(next !== 'open' && next.done).toBe(true);
	});

	it('router fetch: settling the page data gives STALE when the request ends', async () => {
		const request = scope();
		const settled = settle_deferred({ ok: 1, slow: never() }, request);
		request.close();
		expect(await Promise.race([settled, later('waiting' as const, 100)])).toBe(STALE);
	});

	it('router fetch: settling on an ended request gives STALE without waiting', async () => {
		const request = scope();
		request.close();
		const settled = settle_deferred({ slow: never() }, request);
		expect(await Promise.race([settled, later('waiting' as const, 100)])).toBe(STALE);
	});

	it('page facts: a promise still pending when the request ends is rejected', async () => {
		const request = scope();
		const stream = new ReadableStream<Uint8Array>({
			start(c) {
				const flat = [{ slow: 1 }, ['Promise', 2], 1];
				c.enqueue(
					bytes(`${JSON.stringify({ type: 'data', nodes: [{ type: 'data', data: flat }] })}\n`)
				);
			}
		});
		const facts = await look_up_page(
			new URL('https://a.test/x'),
			async () => new Response(stream),
			{},
			request
		);
		if (!('data' in facts)) throw new Error('no facts');
		const slow = facts.data.slow as Promise<unknown>;
		request.close();
		const got = await Promise.race([
			slow.then(
				() => 'resolved',
				(e: unknown) => e
			),
			later('waiting' as const, 100)
		]);
		expect(got).not.toBe('waiting');
		expect(got).not.toBe('resolved');
	});

	it('page facts: a promise whose answer ended without its value is rejected, coded', async () => {
		const flat = [{ slow: 1 }, ['Promise', 2], 1];
		const body = `${JSON.stringify({ type: 'data', nodes: [{ type: 'data', data: flat }] })}\n`;
		const facts = await look_up_page(
			new URL('https://a.test/x'),
			async () => new Response(body),
			{},
			scope()
		);
		if (!('data' in facts)) throw new Error('no facts');
		const got = await Promise.race([
			(facts.data.slow as Promise<unknown>).then(
				() => 'resolved',
				(e: unknown) => e
			),
			later('waiting' as const, 100)
		]);
		expect(got).toMatchObject({ code: 'page_promise_unresolved' });
	});

	it('page facts: a chunk that came still resolves its promise', async () => {
		const flat = [{ slow: 1 }, ['Promise', 2], 1];
		const body = [
			JSON.stringify({ type: 'data', nodes: [{ type: 'data', data: flat }] }),
			JSON.stringify({
				type: 'chunk',
				id: 1,
				data: JSON.parse(devalue.stringify('later'))
			})
		].join('\n');
		const facts = await look_up_page(
			new URL('https://a.test/x'),
			async () => new Response(`${body}\n`),
			{},
			scope()
		);
		if (!('data' in facts)) throw new Error('no facts');
		await expect(facts.data.slow).resolves.toBe('later');
	});
});

describe('a load promise that rejects after the request ended is still handled', () => {
	const unhandled: unknown[] = [];
	const on_unhandled = (reason: unknown) => void unhandled.push(reason);

	it('settling the data', async () => {
		process.on('unhandledRejection', on_unhandled);
		const request = scope();
		request.close();
		let fail!: (e: unknown) => void;
		const out = settle_deferred({ x: new Promise((_, reject) => (fail = reject)) }, request);
		fail(new Error('a load promise that failed'));
		expect(await out).toBe(STALE);
		await later(null, 20);
		process.off('unhandledRejection', on_unhandled);
		expect(unhandled).toEqual([]);
	});

	it('streaming the data', async () => {
		unhandled.length = 0;
		process.on('unhandledRejection', on_unhandled);
		const request = scope();
		let fail!: (e: unknown) => void;
		stream_page_deferred(
			request,
			kit_doc(),
			[{ id: 0, promise: new Promise((_, reject) => (fail = reject)) }],
			1
		);
		request.close();
		fail(new Error('a load promise that failed'));
		await later(null, 20);
		process.off('unhandledRejection', on_unhandled);
		expect(unhandled).toEqual([]);
	});
});

describe('dev: a streamed promise still pending after 10 s is said once', () => {
	it('navigation stream: one coded warning, none after it settles', async () => {
		vi.useFakeTimers();
		const said = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const request = scope();
		const res = stream_page_deferred(
			request,
			kit_doc(),
			[
				{ id: 0, promise: never() },
				{ id: 1, promise: never() }
			],
			2
		);
		const reader = res.body!.getReader();
		await reader.read();
		await vi.advanceTimersByTimeAsync(9_999);
		expect(said).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(said).toHaveBeenCalledTimes(1);
		expect(String(said.mock.calls[0][0])).toContain('page_promise_pending');
		await vi.advanceTimersByTimeAsync(30_000);
		expect(said).toHaveBeenCalledTimes(1);
		request.close();
	});

	it('router fetch: one coded warning while settling waits', async () => {
		vi.useFakeTimers();
		const said = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const request = scope();
		void settle_deferred({ a: never(), b: never() }, request);
		await vi.advanceTimersByTimeAsync(10_000);
		expect(said).toHaveBeenCalledTimes(1);
		expect(String(said.mock.calls[0][0])).toContain('page_promise_pending');
		request.close();
	});

	it('a promise that settles in time says nothing', async () => {
		vi.useFakeTimers();
		const said = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const request = scope();
		const out = settle_deferred({ a: Promise.resolve(1) }, request);
		await vi.advanceTimersByTimeAsync(20_000);
		expect(await out).not.toBe(STALE);
		expect(said).not.toHaveBeenCalled();
		request.close();
	});
});
