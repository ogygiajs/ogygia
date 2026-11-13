/**
 * What `server/page-stream.ts` states, against the source: the walks never stop short of a promise
 * and never loop on a cycle, the seed reducers keep id 0, and the streamed tail forwards Kit's
 * document up to `</body>` (even split over two chunks), drops Kit's dead tail after it, survives
 * Kit's stream breaking, streams nested promises with ids past the initial set, and stops when the
 * request ends. Real streams, read to their end.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { stringify } from 'devalue';
import { scope } from '@ogygia/machine';
import {
	DeferRef,
	page_seed_reducers,
	settle_deferred,
	SettledRef,
	stage_deferred,
	stream_page_deferred
} from '../src/server/page-stream.ts';

const bytes = (s: string) => new TextEncoder().encode(s);

/** A Kit response whose body is these chunks, then (optionally) an error instead of a close. */
function kit(chunks: string[], end: 'close' | 'error' = 'close', headers?: HeadersInit) {
	let pulled = 0;
	let cancelled = false;
	const body = new ReadableStream<Uint8Array>({
		pull(c) {
			if (pulled < chunks.length) c.enqueue(bytes(chunks[pulled++]));
			else if (end === 'error') c.error(new Error('kit broke'));
			else c.close();
		},
		cancel() {
			cancelled = true;
		}
	});
	return {
		response: new Response(body, { status: 203, statusText: 'Kit', headers }),
		pulled: () => pulled,
		cancelled: () => cancelled
	};
}

/** The response's whole body, or `null` when it does not close within `ms`. */
async function read_all(res: Response, ms = 2000): Promise<string | null> {
	const reader = res.body!.getReader();
	const decoder = new TextDecoder();
	let text = '';
	const end = Date.now() + ms;
	for (;;) {
		const left = end - Date.now();
		const late = new Promise<'late'>((r) => setTimeout(() => r('late'), Math.max(0, left)));
		const got = await Promise.race([reader.read(), late]);
		if (got === 'late') {
			void reader.cancel();
			return null;
		}
		if (got.done) return text;
		text += decoder.decode(got.value, { stream: true });
	}
}

const later = <T>(value: T, ms: number) => new Promise<T>((r) => setTimeout(() => r(value), ms));

const unhandled: unknown[] = [];
process.on('unhandledRejection', (reason) => void unhandled.push(reason));
afterEach(() => {
	unhandled.length = 0;
});

/** `depth` levels of `{ nest }` around `leaf`. */
function nested(leaf: unknown, depth: number): unknown {
	let v = leaf;
	for (let i = 0; i < depth; i++) v = { nest: v };
	return v;
}

describe('the walks', () => {
	// (66 levels and deeper are left raw: #569)
	it('stage_deferred checks for a promise before the plain-walk cap, so one 65 levels down is staged', () => {
		const { deferred } = stage_deferred(nested(Promise.resolve('deep'), 65), 0);
		expect(deferred).toHaveLength(1);
	});

	it('settle_deferred checks for a promise before the plain-walk cap, so one 65 levels down is awaited', async () => {
		let out = (await settle_deferred(nested(Promise.resolve('deep'), 65), scope())) as {
			nest?: unknown;
		};
		while (out.nest !== undefined) out = out.nest as { nest?: unknown };
		expect(out).toBeInstanceOf(SettledRef);
		expect((out as unknown as SettledRef).value).toBe('deep');
	});

	it('a cyclic plain value ends both walks instead of overflowing the stack', async () => {
		const cycle: Record<string, unknown> = { a: 1 };
		cycle.self = cycle;
		const list: unknown[] = [];
		list.push(list);
		expect(() => stage_deferred({ cycle, list }, 0)).not.toThrow();
		await expect(settle_deferred({ cycle, list }, scope())).resolves.toBeDefined();
	});

	it('a list that holds itself, and nothing else cyclic, ends the staging walk too', () => {
		const list: unknown[] = [];
		list.push(list, Promise.resolve('in the list'));
		const { deferred } = stage_deferred(list, 0);
		expect(deferred).toHaveLength(1);
	});

	it('the page seed reducers keep id 0 and a settled leaf, nested rich values and all', () => {
		const when = new Date('2020-01-02T03:04:05.000Z');
		const text = stringify(
			{ d: new DeferRef(0), s: new SettledRef(true, { when }) },
			page_seed_reducers
		);
		expect(text).toContain('"OgygiaDefer"');
		expect(text).toContain('"OgygiaSettled"');
		expect(text).toContain('["Date","2020-01-02T03:04:05.000Z"]');
	});
});

describe('stream_page_deferred', () => {
	it('forwards the document through `</body>` split over two chunks, and drops Kit’s tail after it', async () => {
		const source = kit([
			'<html><body><p>page</p></bo',
			'dy></html>',
			'<script>__sveltekit_dead(0)</script>',
			'<script>__sveltekit_dead(1)</script>',
			'<script>__sveltekit_dead(2)</script>',
			'<script>__sveltekit_dead(3)</script>'
		]);
		const res = stream_page_deferred(
			scope(),
			source.response,
			[{ id: 0, promise: Promise.resolve('v') }],
			1
		);
		const body = await read_all(res);
		expect(body).toMatch(
			/^<html><body><p>page<\/p><\/body><\/html><script>__ogygia_page_resolve\(0,true,/
		);
		expect(body).not.toContain('__sveltekit_dead');
		await later(null, 10);
		expect(source.pulled()).toBe(6);
	});

	it('a Kit stream that breaks before `</body>` still streams every resolve and closes', async () => {
		const source = kit(['<html><body><p>page'], 'error');
		const res = stream_page_deferred(
			scope(),
			source.response,
			[{ id: 0, promise: later('v', 5) }],
			1
		);
		const body = await read_all(res);
		expect(body).not.toBeNull();
		expect(body).toContain('<p>page');
		expect(body).toMatch(/__ogygia_page_resolve\(0,true,/);
		expect(unhandled).toEqual([]);
	});

	it('a value holding promises streams them too, with ids past the initial set, and closes after the last', async () => {
		const source = kit(['<html><body></body></html>']);
		const res = stream_page_deferred(
			scope(),
			source.response,
			[
				{ id: 0, promise: Promise.resolve({ inner: later('deep', 20) }) },
				{ id: 1, promise: later({ other: later('deeper', 10) }, 5) }
			],
			2
		);
		const body = await read_all(res);
		expect(body).toMatch(/__ogygia_page_resolve\(0,true,/);
		expect(body).toMatch(/__ogygia_page_resolve\(1,true,/);
		expect(body).toMatch(/__ogygia_page_resolve\(2,true,"\[\\"deep\\"\]"\)/);
		expect(body).toMatch(/__ogygia_page_resolve\(3,true,"\[\\"deeper\\"\]"\)/);
		expect(body!.indexOf('resolve(2,')).toBeGreaterThan(body!.indexOf('resolve(0,'));
	});

	it('no promises: the document, then the stream closes', async () => {
		const source = kit(['<html><body></body></html>']);
		const res = stream_page_deferred(scope(), source.response, [], 0);
		expect(await read_all(res)).toBe('<html><body></body></html>');
	});

	it('the request ending stops Kit’s reader and drops what settles after', async () => {
		const request = scope();
		let cancelled = false;
		// (no `</body>` and a Kit stream that never closes: the reader is still on Kit when the request ends)
		const never = new ReadableStream<Uint8Array>({
			start(c) {
				c.enqueue(bytes('<html><body><p>page</p>'));
			},
			cancel() {
				cancelled = true;
			}
		});
		let resolve!: (v: string) => void;
		const res = stream_page_deferred(
			request,
			new Response(never),
			[{ id: 0, promise: new Promise<string>((r) => (resolve = r)) }],
			1
		);
		const reader = res.body!.getReader();
		const first = await reader.read();
		expect(new TextDecoder().decode(first.value)).toBe('<html><body><p>page</p>');
		request.close();
		await later(null, 5);
		expect(cancelled).toBe(true);
		resolve('late');
		await later(null, 5);
		const next = await Promise.race([reader.read(), later('nothing' as const, 50)]);
		expect(next === 'nothing' || next.done || next.value === undefined).toBe(true);
	});

	it('a cancelled body ends the request’s stream: Kit’s reader stops', async () => {
		let cancelled = false;
		const never = new ReadableStream<Uint8Array>({
			start(c) {
				c.enqueue(bytes('<html><body><p>page</p>'));
			},
			cancel() {
				cancelled = true;
			}
		});
		const res = stream_page_deferred(
			scope(),
			new Response(never),
			[{ id: 0, promise: new Promise(() => {}) }],
			1
		);
		const reader = res.body!.getReader();
		await reader.read();
		await reader.cancel();
		await later(null, 5);
		expect(cancelled).toBe(true);
	});

	it('keeps the status and headers, without content-length (the body grew)', async () => {
		const source = kit(['<html><body></body></html>'], 'close', {
			'content-type': 'text/html',
			'content-length': '26'
		});
		const res = stream_page_deferred(
			scope(),
			source.response,
			[{ id: 0, promise: Promise.resolve(1) }],
			1
		);
		expect(res.status).toBe(203);
		expect(res.statusText).toBe('Kit');
		expect(res.headers.get('content-type')).toBe('text/html');
		expect(res.headers.has('content-length')).toBe(false);
		await read_all(res);
	});

	it('a response with no body is passed back as it is', () => {
		const res = new Response(null, { status: 204 });
		expect(stream_page_deferred(scope(), res, [], 0)).toBe(res);
	});
});
