/**
 * THE REQUEST'S OWNER — one scope per server request: the timers, streams, readers and fetches the
 * request starts are its, and go when it ends.
 *
 *   const owner = request_scope(event.request);
 *   owner.timeout(give_up, 5000);                     // cleared when the request ends
 *   owner.defer(() => void reader.cancel());          // the reader stops with it
 *   fetch(url, { signal: owner.signal });             // aborted when the visitor leaves
 *
 * It ends at the first of:
 * - the response ends: its body is read to the end, or cancelled (a streamed page included: its
 *   body is the response's, so it ends when the stream does), or it has a body the platform will
 *   not read (a HEAD answer, or a page SvelteKit turns into a 304), which ends at once;
 * - the visitor leaves: `request.signal` aborts.
 *
 * The handle makes it when the request comes in and closes it at the end of the response
 * (`own_response`). Code with no handle around it (a test, a render off-request) still gets one,
 * made on first touch and closed when `request.signal` aborts.
 *
 * A value that lives as long as one request is a `request_local`: made the first time the request
 * asks for it, and let go (disposed) when the request ends. Keyed by the request, like its facts.
 *
 * One global slot, not module scope: a plugin package and core can end up as two module instances
 * of this file (src beside dist, a dual install), and both must find the same owner.
 */
import { noop, scope, slot as shared, type Scope } from '@ogygia/machine';
import { current_request } from './facts.ts';
import { warn } from '../messages/server.ts';
import { note_response_end } from '../server/rules.ts';

// the server's rules (../server/rules.ts): dev, and a build made with OGYGIA_RULES=1; folds out
// of any other build
const RULES =
	import.meta.env?.DEV || (typeof __OGYGIA_RULES__ !== 'undefined' ? __OGYGIA_RULES__ : false);

type Entry = { owner: Scope; locals: Map<object, unknown> | null };
type Slot = { by_request: WeakMap<Request, Entry> };

const slot = shared<Slot>({
	name: 'ogygia.request-scope',
	version: 1,
	make: () => ({ by_request: new WeakMap() })
});

function entry_of(request: Request): Entry {
	let entry = slot.by_request.get(request);
	if (entry === undefined) {
		const owner = scope();
		const signal = request.signal;
		if (signal.aborted) owner.close();
		else owner.on(signal, 'abort', () => end_request_scope(owner));
		entry = { owner, locals: null };
		slot.by_request.set(request, entry);
	}
	return entry;
}

/** The owner of `request` (made on first touch). */
export function request_scope(request: Request): Scope {
	return entry_of(request).owner;
}

/** The owner of the request the running code belongs to, or null outside one. */
export function current_request_scope(): Scope | null {
	const request = current_request();
	return request ? entry_of(request).owner : null;
}

/** A value per request: `make` runs the first time a request asks, and what it made is disposed
 *  when that request ends. Asked after the end, it is made and disposed at once. */
export function request_local<T extends Disposable>(
	make: (owner: Scope) => T
): (request: Request) => T {
	const key = {};
	return (request) => {
		const entry = entry_of(request);
		let value = entry.locals?.get(key) as T | undefined;
		if (value === undefined) {
			value = entry.owner.adopt(make(entry.owner));
			(entry.locals ??= new Map()).set(key, value);
		}
		return value;
	};
}

/** Says that a cleanup of a request's work failed (`request_cleanup_failed`, the error after it):
 *  for an ending nobody waits on, such as a stream source ended as the visitor leaves. */
export function cleanup_failed(error: unknown): void {
	warn('request_cleanup_failed', error);
}

/** Ends a request's owner. A cleanup that throws is said, never thrown: the response is not its. */
export function end_request_scope(owner: Scope): void {
	try {
		owner.close();
	} catch (error) {
		cleanup_failed(error);
	}
}

/**
 * Will the platform answer `request` with `response` without reading its body? A HEAD answer sends
 * none, and SvelteKit turns a 200 whose etag the visitor already has into a 304 after the handle
 * returns, dropping the body (the same match as its respond: a `W/` prefix on the asked etag
 * ignored). Nobody reads or cancels such a body, so its end would never come.
 */
function body_unread(request: Request, response: Response): boolean {
	if (request.method === 'HEAD') return true;
	if (response.status !== 200) return false;
	const etag = response.headers.get('etag');
	if (etag === null) return false;
	let asked = request.headers.get('if-none-match');
	if (asked?.startsWith('W/"')) asked = asked.slice(2);
	return asked === etag;
}

/**
 * Core only (the handle): `response` to `request`, whose end ends `owner`. No body, or one the
 * platform will not read (`body_unread`): it ends now. A body: the response carries it through as
 * it is, chunk by chunk, and its last chunk read or its cancel ends the owner; the owner ending
 * first (the visitor left) cancels the body and ends the response.
 */
export function own_response(owner: Scope, response: Response, request: Request): Response {
	const body = response.body;
	if (body === null || owner.closed) {
		end_request_scope(owner);
		if (RULES) note_response_end(owner);
		return response;
	}
	if (body_unread(request, response)) {
		// oxlint-disable-next-line ogygia/no-silent-failures -- the body is dropped unread, so a failed cancel has nothing to stop
		body.cancel().catch(noop);
		end_request_scope(owner);
		if (RULES) note_response_end(owner);
		return response;
	}
	const reader = body.getReader();
	// oxlint-disable-next-line ogygia/no-silent-failures -- the request ended; a failed cancel of its body has nothing left to stop
	owner.defer(() => void reader.cancel().catch(noop));
	const carried = new ReadableStream<Uint8Array>(
		{
			async pull(controller) {
				let step: ReadableStreamReadResult<Uint8Array>;
				try {
					step = await reader.read();
				} catch (error) {
					end_request_scope(owner);
					if (RULES) note_response_end(owner);
					controller.error(error);
					return;
				}
				if (step.done) {
					controller.close();
					end_request_scope(owner);
					if (RULES) note_response_end(owner);
				} else controller.enqueue(step.value);
			},
			cancel() {
				end_request_scope(owner);
				if (RULES) note_response_end(owner);
			}
		},
		{ highWaterMark: 0 }
	);
	return new Response(carried, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers
	});
}
