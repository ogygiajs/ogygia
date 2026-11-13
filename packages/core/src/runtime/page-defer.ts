import { boot_link } from './slots.ts';
import { OgygiaError } from '../messages/lazy.ts';
import {
	PAGE_DEFER_KEY,
	PAGE_SETTLED_KEY,
	PAGE_DEFER_GLOBAL,
	PAGE_DEFER_REGISTRY_KEY
} from '../page-defer.ts';

export { PAGE_DEFER_BOOTSTRAP } from '../page-defer.ts';

type Settle = { resolve: (v: unknown) => void; reject: (e: unknown) => void };
interface Registry {
	q?: Array<[id: number, ok: boolean, encoded: string]>;
	live?: (id: number, ok: boolean, encoded: string) => void;
	// oxlint-disable-next-line ogygia/no-promise-cache -- not a cache: a streamed value's one promise per id, a rejection included (it is the value the server sent)
	promises?: Map<number, Promise<unknown>>;
	waiting?: Map<number, Settle>;
	revivers?: Record<string, (payload: never) => unknown>;
	t?: Record<number, number>;
	arriving?: Set<number>;
	loaded?: boolean;
}

function reg(): Registry {
	const g = globalThis as unknown as Record<symbol, Registry | undefined>;
	return (g[PAGE_DEFER_REGISTRY_KEY] ??= {});
}

function to_error(value: unknown): Error {
	if (value instanceof Error) return value;
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
	const promises = (r.promises ??= new Map());
	const existing = promises.get(id);
	if (existing) return existing;
	let settle_it!: Settle;
	const promise = new Promise<unknown>((resolve, reject) => (settle_it = { resolve, reject }));
	promise.catch(() => {}); // ok: the same promise is handed back, and its `{#await}` sees the rejection; no unhandled-rejection noise if a rejected leaf goes un-awaited
	promises.set(id, promise);
	(r.waiting ??= new Map()).set(id, settle_it);
	if (r.loaded && !r.arriving?.has(id)) settle(id, false, unresolved('stream'));
	return promise;
}

function unresolved(why: 'stream' | 'devalue'): Error {
	return new OgygiaError('page_promise_unresolved', { why });
}

function document_loaded(): void {
	const r = reg();
	r.loaded = true;
	for (const id of r.waiting?.keys() ?? [])
		if (!r.arriving?.has(id)) settle(id, false, unresolved('stream'));
}

function settle(id: number, ok: boolean, value: unknown): void {
	const r = reg();
	r.arriving?.delete(id);
	const waiting = r.waiting?.get(id);
	if (waiting) {
		r.waiting!.delete(id);
		if (ok) waiting.resolve(value);
		else waiting.reject(to_error(value));
		return;
	}
	const promises = (r.promises ??= new Map());
	if (promises.has(id)) return;
	const promise = ok ? Promise.resolve(value) : Promise.reject(to_error(value));
	promise.catch(() => {}); // ok: the same promise is handed back, and its `{#await}` sees the rejection; resolve raced ahead of the island — guard before `{#await}` attaches its :catch
	promises.set(id, promise);
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
