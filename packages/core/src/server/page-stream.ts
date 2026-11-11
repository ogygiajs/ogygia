import { stringify } from 'devalue';
import type { Scope } from '@ogygia/machine';
import { PAGE_DEFER_GLOBAL, PAGE_DEFER_KEY, PAGE_SETTLED_KEY } from '../page-defer.ts';
import { escape_script_text } from '../escape.ts';

const MAX_DEPTH = 64;

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
 *  `[ok, value]`; the client revives it as a resolved/rejected Promise. */
export class SettledRef {
	readonly ok: boolean;
	readonly value: unknown;

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

/**
 * Replace every promise in `value` with a {@link DeferRef}, returning the promise-free clone plus the
 * deferred promises (id + promise to await). Plain objects/arrays are cloned; class instances and
 * primitives pass through untouched. Ids continue from `start_id` so `data` and `form` share one id
 * space across the whole seed. The walk stops at 64 levels of plain nesting, so a cyclic value ends;
 * a promise is checked before that cap (one 66 or more levels down is missed: #569).
 */
export function stage_deferred(
	value: unknown,
	start_id = 0
): { staged: unknown; deferred: Deferred[]; next_id: number } {
	const deferred: Deferred[] = [];
	let id = start_id;
	const walk = (v: unknown, depth: number): unknown => {
		if (is_thenable(v)) {
			const ref = new DeferRef(id++);
			deferred.push({ id: ref.id, promise: v });
			return ref;
		}
		if (depth > MAX_DEPTH) return v;
		if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
		if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
			const out: Record<string, unknown> = {};
			for (const k in v as Record<string, unknown>)
				out[k] = walk((v as Record<string, unknown>)[k], depth + 1);
			return out;
		}
		return v;
	};
	return { staged: walk(value, 0), deferred, next_id: id };
}

/**
 * Non-navigate (SPA/router) fallback: deep-await every promise in `value`, wrapping each ORIGINAL
 * promise position in a {@link SettledRef} (resolved OR rejected — a rejection is caught, never
 * thrown, so the render can't crash). Nested promises inside a resolved value are settled too. The
 * client revives each SettledRef as a resolved/rejected Promise, so `page.data.x` stays a Promise on
 * this path exactly as on the streaming path, and `{#await …:catch}` works. The same 64-level cap
 * as {@link stage_deferred}, with a promise checked before it.
 */
export async function settle_deferred(value: unknown, depth = 0): Promise<unknown> {
	if (is_thenable(value)) {
		try {
			const resolved = await value;
			return new SettledRef(true, await settle_deferred(resolved, depth + 1));
		} catch (err) {
			return new SettledRef(false, normalize_error(err));
		}
	}
	if (depth > MAX_DEPTH) return value;
	if (Array.isArray(value)) return Promise.all(value.map((x) => settle_deferred(x, depth + 1)));
	if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
		const out: Record<string, unknown> = {};
		await Promise.all(
			Object.keys(value).map(async (k) => {
				out[k] = await settle_deferred((value as Record<string, unknown>)[k], depth + 1);
			})
		);
		return out;
	}
	return value;
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
				if (owner.closed) return;
				try {
					controller.enqueue(
						encoder.encode(resolve_script(PAGE_DEFER_GLOBAL, id, { ok, value }, reducers))
					);
				} catch {
					// ok: the client is gone and the stream closed; nobody reads this script
				}
			};
			const settled = (id: number, ok: boolean, value: unknown) => {
				push(id, ok, value);
				pending -= 1;
				maybe_close();
			};
			const stream_one = (id: number, promise: PromiseLike<unknown>) => {
				Promise.resolve(promise).then(
					(value) => {
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
