import { stringify } from 'devalue';
import { noop, STALE, type Scope, type Stale } from '@ogygia/machine';
import { PAGE_DEFER_GLOBAL, PAGE_DEFER_KEY, PAGE_SETTLED_KEY } from '../page-defer.ts';
import { escape_script_text } from '../escape.ts';
import { warn } from '../messages/server.ts';

/** How long a streamed promise waits before dev says so (`page_promise_pending`). Never a deadline:
 *  the wait ends when the promise settles or the request does (test/page-stream-request-owned.test.ts). */
const PENDING_SAID_MS = 10_000;

/** Dev: says once, while `owner` lasts, that a streamed promise of `path` is still pending after
 *  {@link PENDING_SAID_MS}. Returns what calls it off (everything settled). */
function say_if_pending(owner: Scope, path: string): () => void {
	if (!import.meta.env?.DEV) return noop;
	return owner.timeout(
		() => warn('page_promise_pending', { path, ms: PENDING_SAID_MS }),
		PENDING_SAID_MS
	);
}

/** A THENABLE, not just a native Promise — Kit wraps streamed load promises, so `instanceof Promise`
 *  would miss them. Anything with a callable `.then` we can await. */
export const is_thenable = (v: unknown): v is PromiseLike<unknown> =>
	!!v &&
	(typeof v === 'object' || typeof v === 'function') &&
	typeof (v as { then?: unknown }).then === 'function';

/** Serializable stand-in for a pending promise leaf (streaming path). Encodes to its id. */
export class DeferRef {
	readonly id: number;

	constructor(id: number) {
		this.id = id;
	}
}

/** Serializable stand-in for an already-settled promise leaf (non-navigate path). Encodes to
 *  `[ok, value]`; the client revives it as a resolved/rejected Promise. `settle_deferred` places it
 *  during its walk and fills it when the promise settles. */
export class SettledRef {
	ok: boolean;
	value: unknown;

	constructor(ok: boolean, value: unknown) {
		this.ok = ok;
		this.value = value;
	}
}

/** The devalue reducer for a streamed value: a {@link DeferRef} encodes to `[id]`, an array, never
 *  a bare id (devalue reads a falsy `0` as "not handled" and drops the marker). */
export const defer_reducer: Record<string, (v: unknown) => unknown> = {
	[PAGE_DEFER_KEY]: (v: unknown) => (v instanceof DeferRef ? [v.id] : undefined)
};
/** The page seed's devalue reducers: {@link defer_reducer}'s `[id]`, and a {@link SettledRef} as
 *  `[ok, value]`, whose `value` devalue walks too (a nested `Date` or `Map` survives). */
export const page_seed_reducers: Record<string, (v: unknown) => unknown> = {
	[PAGE_DEFER_KEY]: (v: unknown) => (v instanceof DeferRef ? [v.id] : undefined),
	[PAGE_SETTLED_KEY]: (v: unknown) => (v instanceof SettledRef ? [v.ok, v.value] : undefined)
};

export type Deferred = { id: number; promise: PromiseLike<unknown> };

function swap_thenables(
	value: unknown,
	swap: (thenable: PromiseLike<unknown>) => unknown
): unknown {
	if (is_thenable(value)) return swap(value);
	const found: unknown[] = [];
	let clone: unknown;
	try {
		clone = clone_untracked(value, 0, found);
	} catch (err) {
		if (err !== TOO_DEEP) throw err;
		return swap_tracked(value, swap);
	}
	for (let i = 0; i < found.length; i += 3)
		(found[i] as Record<PropertyKey, unknown>)[found[i + 1] as PropertyKey] = swap(
			found[i + 2] as PromiseLike<unknown>
		);
	return clone;
}

const UNTRACKED_DEPTH = 64;
const TOO_DEEP = Symbol('too deep');

function clone_untracked(v: unknown, depth: number, found: unknown[]): unknown {
	if (Array.isArray(v)) {
		if (depth === UNTRACKED_DEPTH) throw TOO_DEEP;
		const out: unknown[] = [];
		out.length = v.length;
		for (let i = 0; i < v.length; i++) {
			if (!(i in v)) continue;
			const x: unknown = v[i];
			if (is_thenable(x)) {
				out[i] = x;
				found.push(out, i, x);
			} else out[i] = clone_untracked(x, depth + 1, found);
		}
		return out;
	}
	if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
		if (depth === UNTRACKED_DEPTH) throw TOO_DEEP;
		const out: Record<string, unknown> = {};
		for (const k in v as Record<string, unknown>) {
			const x = (v as Record<string, unknown>)[k];
			if (is_thenable(x)) {
				out[k] = x;
				found.push(out, k, x);
			} else out[k] = clone_untracked(x, depth + 1, found);
		}
		return out;
	}
	return v;
}

function swap_tracked(value: unknown, swap: (thenable: PromiseLike<unknown>) => unknown): unknown {
	const open = new Map<object, unknown>();
	const walk = (v: unknown): unknown => {
		if (is_thenable(v)) return swap(v);
		if (Array.isArray(v)) {
			const seen = open.get(v);
			if (seen !== undefined) return seen;
			const out: unknown[] = [];
			out.length = v.length;
			open.set(v, out);
			for (let i = 0; i < v.length; i++) if (i in v) out[i] = walk(v[i]);
			open.delete(v);
			return out;
		}
		if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
			const seen = open.get(v);
			if (seen !== undefined) return seen;
			const out: Record<string, unknown> = {};
			open.set(v, out);
			for (const k in v as Record<string, unknown>)
				out[k] = walk((v as Record<string, unknown>)[k]);
			open.delete(v);
			return out;
		}
		return v;
	};
	return walk(value);
}

/**
 * Replace every promise in `value` with a {@link DeferRef}, returning the promise-free clone plus the
 * deferred promises (id + promise to await), in walk order. Ids continue from `start_id` so `data` and
 * `form` share one id space across the whole seed.
 *
 * Plain objects and arrays are cloned (holes kept); class instances and primitives pass through. A
 * promise is found at any depth: one left in place would go unserialized and unhandled, and the
 * seed's `analyze` walk, which decided there is one to find, has no depth cap either. An object met
 * again inside its own walk (a cycle) is its clone, so the clone keeps the cycle and every promise
 * is swapped once.
 */
export function stage_deferred(
	value: unknown,
	start_id = 0
): { staged: unknown; deferred: Deferred[]; next_id: number } {
	const deferred: Deferred[] = [];
	let id = start_id;
	const staged = swap_thenables(value, (promise) => {
		const ref = new DeferRef(id++);
		deferred.push({ id: ref.id, promise });
		return ref;
	});
	return { staged, deferred, next_id: id };
}

/**
 * Non-navigate (SPA/router) fallback: deep-await every promise in `value`, wrapping each ORIGINAL
 * promise position in a {@link SettledRef} (resolved OR rejected — a rejection is caught, never
 * thrown, so the render can't crash). Nested promises inside a resolved value are settled too. The
 * client revives each SettledRef as a resolved/rejected Promise, so `page.data.x` stays a Promise on
 * this path exactly as on the streaming path, and `{#await …:catch}` works. The clone is built in one
 * walk before anything settles, so its keys keep the data's order. Promises are found at any depth,
 * and a cycle is kept, as by {@link stage_deferred}.
 *
 * The wait is the request's (`owner`): no deadline while it lasts, `STALE` the moment it ends (the
 * visitor left), even when a promise never settles. `path` names the page in dev's
 * `page_promise_pending`.
 */
export function settle_deferred(value: unknown, owner: Scope, path = ''): Promise<unknown | Stale> {
	// (started before the task: a closed owner never runs its work, and every promise still needs
	// its rejection handled)
	const settling = settle_all(value);
	return owner.task(async () => {
		const quiet = say_if_pending(owner, path);
		const settled = await settling;
		quiet();
		return settled;
	});
}

async function settle_all(value: unknown): Promise<unknown> {
	const settling: Array<Promise<void>> = [];
	const settled = swap_thenables(value, (promise) => {
		const ref = new SettledRef(true, undefined);
		settling.push(settle_into(ref, promise));
		return ref;
	});
	await Promise.all(settling);
	return settled;
}

async function settle_into(ref: SettledRef, promise: PromiseLike<unknown>): Promise<void> {
	try {
		ref.value = await settle_all(await promise);
	} catch (err) {
		ref.ok = false;
		ref.value = normalize_error(err);
	}
}

/**
 * The streamed resolve `<script>` body for one settled promise. The value is encoded WITH
 * {@link defer_reducer} so a re-staged value carrying nested DeferRef markers (a promise that resolved
 * to a value containing further promises) serializes — the client revives those as fresh pending
 * promises that later resolve scripts settle, exactly like Kit's recursive deferral. `ok=false` carries
 * a normalized `{ message }` (matches the page seed's error shape) so a rejected non-serializable value
 * can't blow up the stream. `<` is escaped so the payload can't break out of the `<script>`.
 */
export function resolve_script(
	global_name: string,
	id: number,
	settled: { ok: boolean; value: unknown },
	reducers: Record<string, (v: unknown) => unknown> = defer_reducer
): string {
	let ok = settled.ok;
	let encoded: string;
	try {
		encoded = stringify(ok ? settled.value : normalize_error(settled.value), reducers);
	} catch {
		encoded = stringify({ message: 'ogygia: streamed value is not serializable' });
		ok = false;
	}
	const json = escape_script_text(JSON.stringify(encoded));
	return `<script>${global_name}(${id},${ok},${json})</script>`;
}

export function normalize_error(err: unknown): { message: string } {
	if (err instanceof Error) return { message: err.message };
	if (err && typeof err === 'object' && 'message' in err)
		return { message: String((err as { message: unknown }).message) };
	return { message: String(err) };
}

const BODY_CLOSE_BYTES = [60, 47, 98, 111, 100, 121, 62];

function has_body_close(carry: Uint8Array, chunk: Uint8Array): boolean {
	const at_bytes = (buf: Uint8Array, i: number) => {
		for (let k = 0; k < 7; k++) if (buf[i + k] !== BODY_CLOSE_BYTES[k]) return false;
		return true;
	};
	for (let i = chunk.lastIndexOf(60); i !== -1; i = i === 0 ? -1 : chunk.lastIndexOf(60, i - 1))
		if (at_bytes(chunk, i)) return true;
	if (!carry.length) return false;
	const seam = new Uint8Array(carry.length + Math.min(6, chunk.length));
	seam.set(carry);
	seam.set(chunk.subarray(0, seam.length - carry.length), carry.length);
	for (let i = 0; i + 7 <= seam.length; i++) if (at_bytes(seam, i)) return true;
	return false;
}

/**
 * Stream the captured `$page.data` promises into islands (csr=false, real browser load). The
 * document — carrying the pending seed + resolve-global bootstrap — is already built by `resolve`;
 * here we (1) forward it through `</body>` (found even when split over two chunks), (2) DRAIN Kit's
 * own dead csr=false resolve tail so its `__sveltekit_<hash> is not defined` never reaches the
 * browser, and (3) emit one `<script>__ogygia_page_resolve(id, ok, value)</script>` per promise AS
 * IT SETTLES — completion order, non-blocking. Each island's `{#await page.data.x}` flips pending →
 * resolved live. A Kit stream that breaks still gets every resolve script.
 *
 * A promise that resolves to a value holding promises is re-staged, like Kit's own recursion: its
 * nested promises stream too, with ids past every id given so far, and the stream closes only once
 * the whole tree has settled. A value that cannot be staged (a getter that throws) is that
 * promise's failure. The status and headers are kept, without `content-length`.
 *
 * The stream is the request's (`request`, its owner). While it lasts a promise may take as long as
 * it takes; when it ends (the visitor left, the body cancelled) Kit's reader stops, every wait on a
 * promise gives `STALE`, and the stream closes, even with a promise that never settles. `path` names
 * the page in dev's `page_promise_pending`.
 */
export function stream_page_deferred(
	request: Scope,
	response: Response,
	deferred: Deferred[],
	initial_next_id: number,
	reducers?: Record<string, (v: unknown) => unknown>,
	path = ''
): Response {
	const source = response.body;
	if (!source) return response;
	const reader = source.getReader();
	const encoder = new TextEncoder();
	const owner = request.child();
	owner.defer(() => void reader.cancel().catch(() => {})); // ok: the request ended; a failed cancel of its source has nothing left to stop
	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			let carry: Uint8Array = new Uint8Array(0);
			try {
				for (;;) {
					const { value, done } = await reader.read();
					if (done) break;
					controller.enqueue(value);
					if (has_body_close(carry, value)) break;
					carry = value.length >= 6 ? value.subarray(value.length - 6) : value;
				}
			} catch {
				// ok: Kit's stream broke; the resolution streaming below still runs
			}
			void (async () => {
				try {
					for (;;) {
						const { done } = await reader.read();
						if (done) break;
					}
				} catch {
					// ok: Kit's dead tail is discarded; a read that fails has nothing left to discard
				}
			})(); // ok: never rejects, its body is caught
			let next_id = initial_next_id;
			let closed = false;
			const quiet = deferred.length ? say_if_pending(owner, path) : noop;
			const close = () => {
				if (closed) return;
				closed = true;
				quiet();
				try {
					controller.close();
				} catch {
					// ok: already closed (the visitor left), which is what this was for
				}
			};
			// (the request's end closes the stream: a promise still pending is let go)
			owner.defer(close);
			const push = (id: number, ok: boolean, value: unknown) => {
				if (owner.closed) return;
				try {
					controller.enqueue(
						encoder.encode(resolve_script(PAGE_DEFER_GLOBAL, id, { ok, value }, reducers))
					);
				} catch {
					// ok: the client is gone and the stream closed; nobody reads this script
				}
			};
			// One promise, as it settles, then the nested ones its value re-staged: done when its whole
			// tree is. A task of the stream's owner: the visitor leaving makes it STALE at once. Its
			// outcome is read before the task, so a closed owner (whose task never runs its work)
			// still leaves no rejection unhandled.
			const stream_one = async (id: number, promise: PromiseLike<unknown>): Promise<void> => {
				const settled = Promise.resolve(promise).then(
					(value) => ({ ok: true as const, value }),
					(error: unknown) => ({ ok: false as const, error })
				);
				const out = await owner.task(() => settled);
				if (out === STALE) return; // the request ended: the stream closed with it
				if (!out.ok) return push(id, false, out.error);
				let staged: ReturnType<typeof stage_deferred>;
				try {
					staged = stage_deferred(out.value, next_id);
				} catch (error) {
					return push(id, false, error);
				}
				next_id = staged.next_id;
				const nested = staged.deferred.map((n) => stream_one(n.id, n.promise));
				push(id, true, staged.staged);
				await Promise.all(nested);
			};
			await Promise.all(deferred.map(({ id, promise }) => stream_one(id, promise)));
			close();
		},
		cancel() {
			owner.close();
		}
	});
	const headers = new Headers(response.headers);
	headers.delete('content-length');
	return new Response(stream, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
}
