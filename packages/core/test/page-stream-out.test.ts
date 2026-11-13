/**
 * The streamed page's tail: Kit's document is forwarded, then one resolve script per `$page.data`
 * promise as it settles, and the stream closes once all have. A promise whose value cannot be staged
 * (a getter that throws as the value is walked for nested promises) is that promise's failure: its
 * island's `{#await}` gets the error, the other promises still stream, the stream still closes, and
 * nothing is left as an unhandled rejection. Real streams, read to their end.
 */
import { afterEach, expect, it } from 'vitest';
import { scope } from '@ogygia/machine';
import { stream_page_deferred } from '../src/server/page-stream.ts';

const kit_document = () =>
	new Response(
		new ReadableStream<Uint8Array>({
			start(c) {
				c.enqueue(new TextEncoder().encode('<html><body><p>page</p></body></html>'));
				c.close();
			}
		}),
		{ headers: { 'content-type': 'text/html' } }
	);

/** The response's whole body, or `null` when it does not close within `ms`. */
async function read_all(res: Response, ms: number): Promise<string | null> {
	const reader = res.body!.getReader();
	const decoder = new TextDecoder();
	let text = '';
	const end = Date.now() + ms;
	for (;;) {
		const left = end - Date.now();
		if (left <= 0) {
			void reader.cancel();
			return null;
		}
		const timer = new Promise<'late'>((r) => setTimeout(() => r('late'), left));
		const got = await Promise.race([reader.read(), timer]);
		if (got === 'late') {
			void reader.cancel();
			return null;
		}
		if (got.done) return text;
		text += decoder.decode(got.value, { stream: true });
	}
}

const unhandled: unknown[] = [];
const on_unhandled = (reason: unknown) => void unhandled.push(reason);
process.on('unhandledRejection', on_unhandled);
afterEach(() => {
	unhandled.length = 0;
});

it('a value whose staging throws fails its own promise; the rest stream and the stream closes', async () => {
	const request = scope();
	const bad = {
		get broken(): never {
			throw new Error('a getter that throws');
		}
	};
	const res = stream_page_deferred(
		request,
		kit_document(),
		[
			{ id: 0, promise: Promise.resolve(bad) },
			{ id: 1, promise: new Promise((r) => setTimeout(() => r('later'), 20)) }
		],
		2
	);
	const body = await read_all(res, 2000);
	await new Promise((r) => setTimeout(r, 20));
	expect(body).not.toBeNull();
	expect(body).toContain('</body></html>');
	expect(body).toMatch(/__ogygia_page_resolve\(0,false,/);
	expect(body).toContain('a getter that throws');
	expect(body).toMatch(/__ogygia_page_resolve\(1,true,/);
	expect(unhandled).toEqual([]);
	request.close();
});

it('a promise that rejects streams as a failure, with its error, never as a value', async () => {
	const request = scope();
	const res = stream_page_deferred(
		request,
		kit_document(),
		[{ id: 0, promise: Promise.reject(new Error('the load failed')) }],
		1
	);
	const body = await read_all(res, 2000);
	expect(body).toMatch(/__ogygia_page_resolve\(0,false,/);
	expect(body).toContain('the load failed');
	expect(unhandled).toEqual([]);
	request.close();
});

it('a nested promise streams with its parent, and the stream closes only once it settled', async () => {
	const request = scope();
	let inner!: (v: string) => void;
	const res = stream_page_deferred(
		request,
		kit_document(),
		[{ id: 0, promise: Promise.resolve({ more: new Promise<string>((r) => (inner = r)) }) }],
		1
	);
	setTimeout(() => inner('deep'), 20);
	const body = await read_all(res, 2000);
	expect(body).toMatch(/__ogygia_page_resolve\(0,true,[\s\S]*__ogygia_page_resolve\(1,true,/);
	expect(body).toContain('deep');
	request.close();
});

it('the request ending drops what is still out: a value that settles after is never staged', async () => {
	const request = scope();
	let late!: (v: unknown) => void;
	let walked = false;
	stream_page_deferred(
		request,
		kit_document(),
		[{ id: 0, promise: new Promise((r) => (late = r)) }],
		1
	);
	request.close();
	late({
		get seen() {
			walked = true;
			return 1;
		}
	});
	await new Promise((r) => setTimeout(r, 20));
	expect(walked).toBe(false);
	expect(unhandled).toEqual([]);
});

it('the request ending before a promise is streamed still handles its rejection', async () => {
	const request = scope();
	let fail!: (e: unknown) => void;
	stream_page_deferred(
		request,
		kit_document(),
		[{ id: 0, promise: new Promise((_, reject) => (fail = reject)) }],
		1
	);
	request.close();
	fail(new Error('a load promise that failed'));
	await new Promise((r) => setTimeout(r, 20));
	expect(unhandled).toEqual([]);
});
