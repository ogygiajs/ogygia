/**
 * Server side of streaming `$page.data` promises into islands (see `../page-defer.ts` for the why).
 *
 * `stage_deferred` walks the captured page `data`/`form`, swaps every promise for a serializable
 * DEFER MARKER, and hands back the promise-free clone plus the promises to await. The clone goes into
 * the page seed (each marker becomes a real pending Promise on the client); as each promise settles we
 * stream a `<script>__ogygia_page_resolve(id, ok, encoded)</script>` chunk that resolves it live.
 */
import { stringify } from 'devalue';
import type { Scope } from '@ogygia/machine';
import { PAGE_DEFER_GLOBAL, PAGE_DEFER_KEY, PAGE_SETTLED_KEY } from '../page-defer.ts';
import { escape_script_text } from '../escape.ts';

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

// devalue reducers for the page seed. A DeferRef serializes to `[id]` and a SettledRef to `[ok, value]`
// (arrays — NEVER a bare id, which for id 0 is falsy and devalue would read as "not handled", silently
// dropping the marker). `value` is walked recursively by devalue so nested Date/Map survive.
export const defer_reducer: Record<string, (v: unknown) => unknown> = {
	[PAGE_DEFER_KEY]: (v: unknown) => (v instanceof DeferRef ? [v.id] : undefined)
};
export const page_seed_reducers: Record<string, (v: unknown) => unknown> = {
	[PAGE_DEFER_KEY]: (v: unknown) => (v instanceof DeferRef ? [v.id] : undefined),
	[PAGE_SETTLED_KEY]: (v: unknown) => (v instanceof SettledRef ? [v.ok, v.value] : undefined)
};

export type Deferred = { id: number; promise: PromiseLike<unknown> };

/**
 * Clone the plain part of `value` (plain objects and arrays, holes kept), putting `swap(thenable)` in
 * place of every thenable at any depth. Class instances and primitives pass through. An object met
 * again inside its own walk (a cycle) is its clone, so the clone keeps the cycle and every promise is
 * swapped once; an object reached by two separate paths is cloned twice. A promise left in place would
 * go unserialized and unhandled, so there is no depth cap: the seed's `analyze` walk, which decided
 * there is a promise to find, has none either.
 *
 * Most data is shallow and has no cycle, so the first walk tracks nothing and stops at
 * {@link UNTRACKED_DEPTH}; only then is the value walked again with every open object tracked. The
 * first walk swaps nothing until it is done, so a value walked twice swaps each thenable once.
 */
function swap_thenables(
	value: unknown,
	swap: (thenable: PromiseLike<unknown>) => unknown
): unknown {
	if (is_thenable(value)) return swap(value);
	// (flat triples: a clone, a key in it, the thenable that key holds until it is swapped)
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

/** Depth at which the untracked walk gives up: the value is deep, or it holds a cycle. */
const UNTRACKED_DEPTH = 64;
const TOO_DEEP = Symbol('too deep');

/** `swap_thenables`' first walk: clones `v` (never a thenable) and records each thenable's slot in
 *  `found`, in walk order. Throws {@link TOO_DEEP} at {@link UNTRACKED_DEPTH}. */
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

/** `swap_thenables` for a deep or cyclic value: every object whose walk is open is tracked. */
function swap_tracked(value: unknown, swap: (thenable: PromiseLike<unknown>) => unknown): unknown {
	// (each object whose walk is open, to its clone)
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
 * walk before anything settles, so its keys keep the data's order.
 */
export async function settle_deferred(value: unknown): Promise<unknown> {
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
		ref.value = await settle_deferred(await promise);
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
		// Non-serializable resolution — surface a typed error rather than hang the island's `{#await}`.
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

/** `</body>` as bytes (ASCII: the same in every UTF-8 document). */
const BODY_CLOSE_BYTES = [60, 47, 98, 111, 100, 121, 62];

/** Does `</body>` end in `chunk` — searched backwards from its end, where it sits — or straddle the
 *  boundary with the previous chunk's last bytes (`carry`, at most 6)? No decode. */
function has_body_close(carry: Uint8Array, chunk: Uint8Array): boolean {
	const at_bytes = (buf: Uint8Array, i: number) => {
		for (let k = 0; k < 7; k++) if (buf[i + k] !== BODY_CLOSE_BYTES[k]) return false;
		return true;
	};
	for (let i = chunk.lastIndexOf(60); i !== -1; i = i === 0 ? -1 : chunk.lastIndexOf(60, i - 1))
		if (at_bytes(chunk, i)) return true;
	if (!carry.length) return false;
	// the seam: the carry, then the chunk's first bytes
	const seam = new Uint8Array(carry.length + Math.min(6, chunk.length));
	seam.set(carry);
	seam.set(chunk.subarray(0, seam.length - carry.length), carry.length);
	for (let i = 0; i + 7 <= seam.length; i++) if (at_bytes(seam, i)) return true;
	return false;
}

/**
 * Stream the captured `$page.data` promises into islands (csr=false, real browser load). The
 * document — carrying the pending seed + resolve-global bootstrap — is already built by `resolve`;
 * here we (1) forward it, (2) DRAIN Kit's own dead csr=false resolve tail so its
 * `__sveltekit_<hash> is not defined` never reaches the browser, and (3) emit one
 * `<script>__ogygia_page_resolve(id, ok, value)</script>` per promise AS IT SETTLES — completion
 * order, non-blocking. Each island's `{#await page.data.x}` flips pending → resolved live.
 *
 * The stream is the request's (`request`, its owner): the visitor leaving, or the body cancelled,
 * stops Kit's reader and drops what settles after.
 */
export function stream_page_deferred(
	request: Scope,
	response: Response,
	deferred: Deferred[],
	initial_next_id: number,
	reducers?: Record<string, (v: unknown) => unknown>
): Response {
	const source = response.body;
	if (!source) return response;
	const reader = source.getReader();
	const encoder = new TextEncoder();
	const owner = request.child();
	owner.defer(() => void reader.cancel().catch(() => {})); // ok: the request ended; a failed cancel of its source has nothing left to stop
	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			// 1. Forward Kit's document through `</body></html>` (one enqueue in practice). Kit streams
			//    its (dead) resolve scripts only AFTER this, as separate chunks. Carry the last six
			//    decoded characters across reads so a `</body>` split over a chunk boundary is still
			//    detected — never the whole document (a second 2.6 MB copy, rescanned per chunk).
			// (searched as BYTES, backwards from the chunk's end, where `</body>` sits: decoding a whole
			// document just to look at its last bytes was a 2.4 MB string per streamed page)
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
			// 2. Read + discard Kit's dead resolve tail so it never reaches the client and Kit's own
			//    stream closes cleanly (best-effort, runs alongside our resolution streaming).
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
			// 3. Our resolve script per promise, streamed as each settles; close once all have.
			//    A promise may RESOLVE to a value that itself holds promises (Kit re-defers those
			//    recursively). We mirror it: re-stage each settled value, stream the staged value
			//    (nested markers and all), and stream those nested promises too — ids continue past
			//    the initial set. `pending` grows as nested promises appear, so the stream stays open
			//    until the whole tree has settled. `next_id` is the initial contiguous count.
			let pending = deferred.length;
			let next_id = initial_next_id;
			let closed = false;
			const maybe_close = () => {
				if (pending === 0 && !closed) {
					closed = true;
					try {
						controller.close();
					} catch {
						// ok: already closed (the visitor left), which is what this was for
					}
				}
			};
			const push = (id: number, ok: boolean, value: unknown) => {
				if (owner.closed) return; // the visitor left
				try {
					controller.enqueue(
						encoder.encode(resolve_script(PAGE_DEFER_GLOBAL, id, { ok, value }, reducers))
					);
				} catch {
					// ok: the client is gone and the stream closed; nobody reads this script
				}
			};
			// One promise settled, either way: its script is out, and it no longer holds the stream.
			const settled = (id: number, ok: boolean, value: unknown) => {
				push(id, ok, value);
				pending -= 1;
				maybe_close();
			};
			const stream_one = (id: number, promise: PromiseLike<unknown>) => {
				Promise.resolve(promise).then(
					(value) => {
						// a value that cannot be staged (a getter that throws as it is walked) is this
						// promise's failure, not a stream that never closes (#367)
						let staged: ReturnType<typeof stage_deferred>;
						try {
							staged = stage_deferred(value, next_id);
						} catch (error) {
							return settled(id, false, error);
						}
						next_id = staged.next_id;
						pending += staged.deferred.length;
						for (const n of staged.deferred) stream_one(n.id, n.promise);
						settled(id, true, staged.staged);
					},
					(error) => settled(id, false, error)
				);
			};
			for (const { id, promise } of deferred) stream_one(id, promise);
			maybe_close();
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
