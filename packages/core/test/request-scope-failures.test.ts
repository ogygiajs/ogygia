// THE REQUEST'S OWNER WHEN THINGS FAIL (plugin/request-scope.ts). A cleanup that throws as the
// request ends is said, never thrown into the response; a body that breaks mid-stream ends the owner
// and reaches the visitor as the error it is; and a source whose cancel fails, dropped unread or let
// go as the visitor leaves, leaves nothing unhandled.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { end_request_scope, own_response, request_scope } from '../src/plugin/request-scope.ts';
import { scope } from '@ogygia/machine';

const unhandled: unknown[] = [];
const on_unhandled = (reason: unknown) => void unhandled.push(reason);
let said: string[] = [];
beforeEach(() => {
	unhandled.length = 0;
	process.on('unhandledRejection', on_unhandled);
	said = [];
	vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => void said.push(a.join(' ')));
});
afterEach(() => {
	process.off('unhandledRejection', on_unhandled);
	vi.restoreAllMocks();
});
const later = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A source that hands out one chunk, then waits for good; its cancel throws. */
const stuck_source = () =>
	new ReadableStream<Uint8Array>({
		start(c) {
			c.enqueue(new TextEncoder().encode('x'));
		},
		cancel() {
			throw new Error('a source that cannot be cancelled');
		}
	});

it('a cleanup that throws as the request ends is said, never thrown', () => {
	const owner = scope();
	owner.defer(() => {
		throw new Error('a cleanup that broke');
	});
	expect(() => end_request_scope(owner)).not.toThrow();
	expect(owner.closed).toBe(true);
	expect(said.some((s) => s.includes('request_cleanup_failed'))).toBe(true);
});

it('a HEAD answer whose body cannot be cancelled is dropped unread, with nothing unhandled', async () => {
	const r = new Request('http://app.test/', { method: 'HEAD' });
	const owner = request_scope(r);
	own_response(owner, new Response(stuck_source()), r);
	expect(owner.closed).toBe(true);
	await later(10);
	expect(unhandled).toEqual([]);
});

it('the visitor leaving lets go of a source that cannot be cancelled, with nothing unhandled', async () => {
	const leave = new AbortController();
	const r = new Request('http://app.test/', { signal: leave.signal });
	const owner = request_scope(r);
	const res = own_response(owner, new Response(stuck_source()), r);
	const reader = res.body!.getReader();
	expect(new TextDecoder().decode((await reader.read()).value)).toBe('x');
	leave.abort();
	expect(owner.closed).toBe(true);
	await later(10);
	expect(unhandled).toEqual([]);
});

it('a body that breaks mid-stream ends the owner, and the visitor’s read fails with its error', async () => {
	const r = new Request('http://app.test/');
	const owner = request_scope(r);
	let n = 0;
	const broken = new ReadableStream<Uint8Array>({
		pull(c) {
			if (n++ === 0) c.enqueue(new TextEncoder().encode('x'));
			else c.error(new Error('the render broke'));
		}
	});
	const res = own_response(owner, new Response(broken), r);
	const reader = res.body!.getReader();
	expect(new TextDecoder().decode((await reader.read()).value)).toBe('x');
	await expect(reader.read()).rejects.toThrow('the render broke');
	expect(owner.closed).toBe(true);
});
