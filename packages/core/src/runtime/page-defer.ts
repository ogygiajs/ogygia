import { boot_link } from './slots.ts';
import { OgygiaError } from '../messages/lazy.ts';
import {
	PAGE_DEFER_KEY,
	PAGE_SETTLED_KEY,
	PAGE_DEFER_GLOBAL,
	PAGE_DEFER_REGISTRY_KEY
} from '../page-defer.ts';

export { PAGE_DEFER_BOOTSTRAP } from '../page-defer.ts';

type Deferred = {
	promise: Promise<unknown>;
	resolve: (v: unknown) => void;
	reject: (e: unknown) => void;
};
interface Registry {
	q?: Array<[id: number, ok: boolean, encoded: string]>;
	live?: (id: number, ok: boolean, encoded: string) => void;
	deferreds?: Map<number, Deferred>;
	settled?: Map<number, { ok: boolean; value: unknown }>;
	revivers?: Record<string, (payload: never) => unknown>;
	t?: Record<number, number>;
	/** resolves that came and are still on their way in (devalue loading) */
	arriving?: Set<number>;
	/** the document has loaded: every resolve script it holds has run */
	loaded?: boolean;
}

function reg(): Registry {
	const g = globalThis as unknown as Record<symbol, Registry | undefined>;
	return (g[PAGE_DEFER_REGISTRY_KEY] ??= {});
}

function to_error(value: unknown): Error {
	const msg =
		value && typeof value === 'object' && 'message' in value
			? String((value as { message: unknown }).message)
			: 'ogygia: streamed promise rejected';
	return new Error(msg);
}

/**
 * Reviver: a defer marker `[id]` in the page seed becomes a real Promise, so a region's
 * `{#await page.data.x}` shows its pending branch until the streamed
 * `<script>__ogygia_page_resolve(id, ok, encoded)</script>` settles it, live. A resolve that raced
 * ahead of the seed is kept, and the promise comes back already settled; a marker read twice is one
 * promise. The registry is one per document (a `Symbol.for` key), so two copies of the runtime (dev
 * evaluates it twice) share it.
 */
export function create_deferred(id: number): Promise<unknown> {
	const r = reg();
	const deferreds = (r.deferreds ??= new Map());
	const existing = deferreds.get(id);
	if (existing) return existing.promise;
	const early = r.settled?.get(id);
	if (early) {
		r.settled!.delete(id);
		if (early.ok) return Promise.resolve(early.value);
		const p = Promise.reject(to_error(early.value));
		p.catch(() => {}); // ok: the same promise is handed back, and its `{#await}` sees the rejection; resolve raced ahead of the island — guard before `{#await}` attaches its :catch
		return p;
	}
	let resolve!: (v: unknown) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<unknown>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	promise.catch(() => {}); // ok: the same promise is handed back, and its `{#await}` sees the rejection; no unhandled-rejection noise if a rejected leaf goes un-awaited
	deferreds.set(id, { promise, resolve, reject });
	if (r.loaded && !r.arriving?.has(id)) settle(id, false, unresolved('stream'));
	return promise;
}

/** Why a streamed promise settles with no resolve: the document loaded without one (`stream`), or
 *  its resolve came and devalue's download never did (`devalue`). */
function unresolved(why: 'stream' | 'devalue'): Error {
	return new OgygiaError('page_promise_unresolved', { why });
}

/** The document has loaded: every resolve script it holds has run, so a promise with none queued
 *  or on its way in will never get one. */
function document_loaded(): void {
	const r = reg();
	r.loaded = true;
	// (settle deletes from the map it walks: a Map's for…of sees each key once all the same)
	for (const id of r.deferreds?.keys() ?? [])
		if (!r.arriving?.has(id)) settle(id, false, unresolved('stream'));
}

function settle(id: number, ok: boolean, value: unknown): void {
	const r = reg();
	r.arriving?.delete(id);
	const d = r.deferreds?.get(id);
	if (d) {
		r.deferreds!.delete(id);
		if (ok) d.resolve(value);
		else d.reject(to_error(value));
	} else {
		(r.settled ??= new Map()).set(id, { ok, value });
	}
}

/** Install the live resolver (which parses the encoded value with the full reviver map, so a value
 *  holding more defer markers streams on) and drain anything the inline bootstrap queued before the
 *  runtime loaded. With no inline bootstrap (a seed that came by a router navigation) it defines the
 *  resolve global itself. `extra_revivers` are the app's transport decoders (custom types in a
 *  streamed value). Idempotent — safe to call on every boot; the first call's revivers win. */
export function install_page_defer(
	extra_revivers?: Record<string, (payload: never) => unknown>
): void {
	const r = reg();
	if (r.live) return;
	r.revivers = page_defer_revivers(extra_revivers);
	r.live = (id, ok, encoded) => {
		(r.arriving ??= new Set()).add(id);
		boot_link().with_devalue(
			({ parse }) => {
				let value: unknown = null;
				try {
					value = parse(encoded, r.revivers as Parameters<typeof parse>[1]);
				} catch {
					// ok: a mangled chunk resolves to null, never hangs the `{#await}`
				}
				settle(id, ok, value);
			},
			() => settle(id, false, unresolved('devalue'))
		);
	};
	const queued = r.q;
	r.q = [];
	if (queued) for (const [id, ok, encoded] of queued) r.live(id, ok, encoded);
	const g = globalThis as unknown as Record<string, unknown>;
	g[PAGE_DEFER_GLOBAL] ??= (id: number, ok: boolean, encoded: string) => r.live!(id, ok, encoded);
	// (off a document, a test or the server: nothing says when the resolves are done)
	if (typeof document === 'undefined') return;
	if (document.readyState === 'complete') document_loaded();
	// oxlint-disable-next-line ogygia/owned-effects -- the document's own load, once: the registry is the document's and outlives every visit
	else addEventListener('load', document_loaded, { once: true });
}

/** devalue reviver map for the page seed. A DEFER marker becomes a pending Promise (streaming path); a
 *  SETTLED marker becomes an already resolved/rejected Promise (non-navigate path). Both keep
 *  `page.data.x` a Promise, so `{#await}` works identically regardless of how the page was requested.
 *  `extra` merges the app's transport decoders; ogygia's own keys always win on any name clash. */
export function page_defer_revivers(
	extra?: Record<string, (payload: never) => unknown>
): Record<string, (payload: never) => unknown> {
	return {
		...extra,
		[PAGE_DEFER_KEY]: (payload: never) => create_deferred((payload as [number])[0]),
		[PAGE_SETTLED_KEY]: (payload: never) => {
			const [ok, value] = payload as [boolean, unknown];
			if (ok) return Promise.resolve(value);
			const p = Promise.reject(to_error(value));
			p.catch(() => {}); // ok: the same promise is handed back, and its `{#await}` sees the rejection; no unhandled-rejection noise if a rejected leaf goes un-awaited
			return p;
		}
	};
}
