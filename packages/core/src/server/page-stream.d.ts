import type { Scope } from '@ogygia/machine';
/** A THENABLE, not just a native Promise — Kit wraps streamed load promises, so `instanceof Promise`
 *  would miss them. Anything with a callable `.then` we can await. */
export declare const is_thenable: (v: unknown) => v is PromiseLike<unknown>;
/** Serializable stand-in for a pending promise leaf (streaming path). Encodes to its id. */
export declare class DeferRef {
    readonly id: number;
    constructor(id: number);
}
/** Serializable stand-in for an already-settled promise leaf (non-navigate path). Encodes to
 *  `[ok, value]`; the client revives it as a resolved/rejected Promise. */
export declare class SettledRef {
    readonly ok: boolean;
    readonly value: unknown;
    constructor(ok: boolean, value: unknown);
}
export declare const defer_reducer: Record<string, (v: unknown) => unknown>;
export declare const page_seed_reducers: Record<string, (v: unknown) => unknown>;
export type Deferred = {
    id: number;
    promise: PromiseLike<unknown>;
};
/**
 * Replace every promise in `value` with a {@link DeferRef}, returning the promise-free clone plus the
 * deferred promises (id + promise to await). Plain objects/arrays are cloned; class instances and
 * primitives pass through untouched. Ids continue from `start_id` so `data` and `form` share one id
 * space across the whole seed. Bounded depth guards a pathological structure.
 */
export declare function stage_deferred(value: unknown, start_id?: number): {
    staged: unknown;
    deferred: Deferred[];
    next_id: number;
};
/**
 * Non-navigate (SPA/router) fallback: deep-await every promise in `value`, wrapping each ORIGINAL
 * promise position in a {@link SettledRef} (resolved OR rejected — a rejection is caught, never
 * thrown, so the render can't crash). Nested promises inside a resolved value are settled too. The
 * client revives each SettledRef as a resolved/rejected Promise, so `page.data.x` stays a Promise on
 * this path exactly as on the streaming path, and `{#await …:catch}` works.
 */
export declare function settle_deferred(value: unknown, depth?: number): Promise<unknown>;
/**
 * The streamed resolve `<script>` body for one settled promise. The value is encoded WITH
 * {@link defer_reducer} so a re-staged value carrying nested DeferRef markers (a promise that resolved
 * to a value containing further promises) serializes — the client revives those as fresh pending
 * promises that later resolve scripts settle, exactly like Kit's recursive deferral. `ok=false` carries
 * a normalized `{ message }` (matches the page seed's error shape) so a rejected non-serializable value
 * can't blow up the stream. `<` is escaped so the payload can't break out of the `<script>`.
 */
export declare function resolve_script(global_name: string, id: number, settled: {
    ok: boolean;
    value: unknown;
}, reducers?: Record<string, (v: unknown) => unknown>): string;
export declare function normalize_error(err: unknown): {
    message: string;
};
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
export declare function stream_page_deferred(request: Scope, response: Response, deferred: Deferred[], initial_next_id: number, reducers?: Record<string, (v: unknown) => unknown>): Response;
