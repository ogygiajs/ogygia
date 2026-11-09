// THE REQUEST'S OWNER (plugin/request-scope.ts): one scope per request, ended by the first of the
// response's end (its body read to the end, or cancelled) and the visitor leaving (request.signal).
// Real streams, real abort signals.
import { describe, expect, it } from 'vitest';
import { own_response, request_local, request_scope } from '../src/plugin/request-scope.ts';

const request = (signal?: AbortSignal) => new Request('http://app.test/', { signal });

/** A body that hands out `n` chunks and then waits for good, saying when it was cancelled. */
function body(n: number) {
	const seen = { pulls: 0, cancelled: false };
	const stream = new ReadableStream<Uint8Array>({
		pull(controller) {
			if (seen.pulls++ < n) controller.enqueue(new TextEncoder().encode('x'));
			else return new Promise(() => {});
		},
		cancel() {
			seen.cancelled = true;
		}
	});
	return { stream, seen };
}

describe('request_scope', () => {
	it('is one owner per request, made on first touch', () => {
		const r = request();
		expect(request_scope(r)).toBe(request_scope(r));
		expect(request_scope(request())).not.toBe(request_scope(r));
	});

	it('ends when the visitor leaves (request.signal aborts)', () => {
		const leave = new AbortController();
		const owner = request_scope(request(leave.signal));
		let ended = false;
		owner.defer(() => (ended = true));
		leave.abort();
		expect(owner.closed).toBe(true);
		expect(ended).toBe(true);
	});

	it('of a request whose visitor already left is ended', () => {
		const leave = new AbortController();
		leave.abort();
		expect(request_scope(request(leave.signal)).closed).toBe(true);
	});
});

describe('own_response', () => {
	it('a response with no body ends its owner at once', () => {
		const owner = request_scope(request());
		const res = own_response(owner, new Response(null, { status: 204 }));
		expect(res.status).toBe(204);
		expect(owner.closed).toBe(true);
	});

	it('the body read to its end ends the owner, after its last chunk', async () => {
		const owner = request_scope(request());
		const res = own_response(
			owner,
			new Response('<p>page</p>', { status: 201, headers: { 'x-a': '1' } })
		);
		expect(owner.closed).toBe(false);
		expect(res.status).toBe(201);
		expect(res.headers.get('x-a')).toBe('1');
		expect(await res.text()).toBe('<p>page</p>');
		expect(owner.closed).toBe(true);
	});

	it('the body cancelled (the visitor left mid-stream) ends the owner and the source', async () => {
		const owner = request_scope(request());
		const b = body(1);
		const reader = own_response(owner, new Response(b.stream)).body!.getReader();
		await reader.read();
		expect(owner.closed).toBe(false);
		await reader.cancel();
		expect(owner.closed).toBe(true);
		expect(b.seen.cancelled).toBe(true);
	});

	it('the visitor leaving first cancels the source and ends the body', async () => {
		const leave = new AbortController();
		const owner = request_scope(request(leave.signal));
		const b = body(1);
		const reader = own_response(owner, new Response(b.stream)).body!.getReader();
		await reader.read();
		const next = reader.read(); // waits on a source that never answers
		leave.abort();
		expect((await next).done).toBe(true);
		expect(b.seen.cancelled).toBe(true);
	});
});

describe('request_local', () => {
	it('one value per request, disposed when the request ends', () => {
		const disposed: string[] = [];
		const local = request_local((owner) => ({
			owner,
			[Symbol.dispose]: () => void disposed.push('gone')
		}));
		const leave = new AbortController();
		const r = request(leave.signal);
		const v = local(r);
		expect(local(r)).toBe(v);
		expect(v.owner).toBe(request_scope(r));
		expect(local(request())).not.toBe(v);
		leave.abort();
		expect(disposed).toEqual(['gone']);
	});
});
