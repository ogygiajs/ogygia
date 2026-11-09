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
import { type Scope } from '@ogygia/machine';
/** The owner of `request` (made on first touch). */
export declare function request_scope(request: Request): Scope;
/** The owner of the request the running code belongs to, or null outside one. */
export declare function current_request_scope(): Scope | null;
/** A value per request: `make` runs the first time a request asks, and what it made is disposed
 *  when that request ends. Asked after the end, it is made and disposed at once. */
export declare function request_local<T extends Disposable>(make: (owner: Scope) => T): (request: Request) => T;
/** Says that a cleanup of a request's work failed (`request_cleanup_failed`, the error after it):
 *  for an ending nobody waits on, such as a stream source ended as the visitor leaves. */
export declare function cleanup_failed(error: unknown): void;
/** Ends a request's owner. A cleanup that throws is said, never thrown: the response is not its. */
export declare function end_request_scope(owner: Scope): void;
/**
 * Core only (the handle): `response` to `request`, whose end ends `owner`. No body, or one the
 * platform will not read (`body_unread`): it ends now. A body: the response carries it through as
 * it is, chunk by chunk, and its last chunk read or its cancel ends the owner; the owner ending
 * first (the visitor left) cancels the body and ends the response.
 */
export declare function own_response(owner: Scope, response: Response, request: Request): Response;
