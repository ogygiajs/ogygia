/**
 * Transportable stores — the hub's STORE kind.
 *
 * A Svelte store is a live object (closure + methods), so devalue rejects it and a
 * `setContext('cart', store)` silently died at the island boundary. This kind lets a
 * subscribe-shaped value cross the same way `[import.meta.og.wire]` classes do: the CURRENT
 * VALUE travels as data, the CODE comes from a module on the other side, and hub identity
 * makes it live — every encode of one store mints ONE id, and the browser resolves by id,
 * so five islands reading the same context key share one client store. `set` in island A
 * repaints `$store` in island B.
 *
 * Two tiers:
 *  - REGISTERED FACTORY (`__register_store_factory(tag, factory)`): decode calls
 *    `factory(seed)` from the registered module, so custom methods (`add`, `reset`,
 *    `useLocalStorage`, …) are REBUILT, not serialized. A store is branded with its factory
 *    tag via `mark_store` (hand-written today, compiler-emitted later).
 *  - GENERIC (`svelte:writable`): any unbranded subscribe-shaped value. Decode is a plain
 *    `writable(seed)` — value + set/update/subscribe survive; bespoke methods do not (the
 *    boundary classifier warns, naming them).
 *
 * Identity, reunification, per-request server isolation: the hub's (see ref.ts).
 */
/** Devalue custom-type name for store payloads on the wire. */
export declare const STORE_WIRE_KEY = "OgygiaW";
/** Brand carrying a factory tag on a store object (non-enumerable, set by `mark_store`). */
declare const STORE_TAG: unique symbol;
interface StoreLike {
    subscribe: (run: (value: unknown) => void) => unknown;
    set?: (value: unknown) => void;
    update?: (fn: (value: unknown) => unknown) => void;
    [STORE_TAG]?: string;
}
/** Legacy wire shape (`t` factory tag, `i` id, `d` current value) — a hub Ref minus its kind. */
interface StorePayload {
    t: string;
    i: string;
    d: unknown;
}
/** Subscribe-shaped, NOT a `[ogygia.wire]` class instance (wire kind), and NOT an `og_derived`
 *  (the derived kind carries its recipe — the store kind would freeze it to a seed). */
export declare function is_store(value: unknown): value is StoreLike;
/** A readable with no way back in — seeding it loses the derivation (classifier warns). */
export declare function is_derived_like(value: StoreLike): boolean;
/**
 * Register a store factory under a stable tag (root-relative module path + export name, same
 * scheme as transportable classes). Decode calls `factory(seed)`, so the rebuilt store keeps
 * every method the factory grafts on. Over-registration is harmless.
 */
export declare function __register_store_factory(tag: string, factory: unknown): void;
/**
 * Brand a store with its factory tag so encode ships the tag instead of the generic one.
 * Returns the store (chainable at a return site). Hand-written today; the auto-wire compiler
 * pass will emit this into provably store-returning factories.
 *
 * THE FLOOR: never detonate on a product that can't carry a brand. A factory may legitimately
 * return undefined/a primitive on one side (SSR-guard pattern) — that passes through unbranded
 * (the `__og_store` wrapper owns the warning, so hand callers stay silent-by-contract). A
 * frozen/sealed store can't take the stamp either — it degrades to the generic tier (value
 * still crosses; only factory-grafted methods are lost), with a warning naming the tag.
 */
export declare function mark_store<T extends object>(store: T, tag: string): T;
/** The hub kind: subscribe-shaped values. The moment of crossing is the value snapshot. */
export declare function register_store_kind(): void;
/**
 * Devalue reducer: encode a store, or return undefined to fall through. Reads the store's
 * CURRENT value with `get()` — the moment of crossing is the snapshot. Same instance → same
 * wire id (hub-memoized), which is what lets the client reunite every copy into one live store.
 */
export declare function reduce_store(value: unknown): StorePayload | undefined;
/**
 * Devalue reviver: rebuild a live store via the hub. `remember: true` (browser) memoizes by
 * wire id — every island decoding this handle gets the SAME store, which is the liveness
 * mechanism. `remember: false` (server) always builds fresh: per-request isolation.
 */
export declare function revive_store(payload: StorePayload, remember: boolean): unknown;
export declare function __og_store<F extends (...args: never[]) => object>(tag: string, factory: F): F;
type AnyStore = {
    subscribe: (run: (v: unknown) => void) => unknown;
};
/**
 * A `derived` that CROSSES boundaries ALIVE — resumability for the reactive graph.
 *
 * Svelte's `derived` is a live computation: sources + a formula. The value can serialize; the
 * computation can't — so a plain derived crosses as a FROZEN seed (the classifier warns). This
 * primitive remembers its RECIPE, and the recipe is made of exactly the two things the seam
 * already carries: sources are STORES (they reunify to one live instance per island page) and
 * the formula is a FUNCTION (mark it with `import.meta.og.$` so it travels as a fn ref).
 *
 * ```ts
 * const doubled = og_derived(tally, import.meta.og.$((n) => n * 2));
 * ```
 *
 * Locally it IS `svelte/store`'s derived — same laziness, same semantics. At a boundary the
 * derived kind ships `{ sources, formula, seed }`; the island decodes by re-deriving against
 * the REUNIFIED sources with the REBOUND formula: bump the source in any island and every
 * island's derived follows. The seed rides along only for exactness of the first paint.
 *
 * An UNMARKED formula still works same-tree, but the derived then can't cross (the fn ref
 * can't be built) — the boundary explains this at the seam rather than freezing silently.
 */
export declare function og_derived<T>(sources: AnyStore | AnyStore[], fn: (...vals: never[]) => T, initial?: T): {
    subscribe: (run: (v: T) => void) => () => void;
};
/** The hub kind: an `og_derived` recipe. Sources and formula are shipped as NESTED refs (devalue
 *  recursion runs the reducer over `d`'s contents), so by decode time they are already LIVE —
 *  sources reunified, formula rebound — and re-deriving is one call. */
export declare function register_derived_kind(): void;
export {};
