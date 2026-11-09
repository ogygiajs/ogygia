/**
 * Transportable functions — the hub's FN kind (the runtime half of `import.meta.og.$`).
 *
 * A closure can never serialize — there is no runtime API for a function's captured scope.
 * What CAN cross is a QRL-style handle: WHERE the code lives (a build tag) plus WHAT it
 * closed over (bound captures, as data). The compiler half (a later phase) hoists a marked
 * closure to a generated module at build time:
 *
 * ```ts
 * // source:                         setContext('fmt', import.meta.og.$((n) => `${n * rate}`));
 * // generated module (tagged):      export const $0 = (rate) => (n) => `${n * rate}`;
 * //                                 __register_fn('routes/+layout#$0', $0);
 * // call site rewrites to:          setContext('fmt', fn_handle('routes/+layout#$0', [rate]));
 * ```
 *
 * This module is the machinery both halves share: the factory registry, the branded live
 * handle (`fn_handle` — callable on the SERVER leg too, where the factory module is loaded),
 * and the kind. Decode = look the tag up, `factory(...bound)` → the live closure. Captures
 * are themselves refs-or-data, so a bound capture may be a store/wire instance that reunites.
 *
 * IDENTITY: functions are deliberately NEVER memoized by the hub (`resolve` only remembers
 * objects). Each consumer rebinds its own closure — stateless until called, exactly like
 * snippets. Anything stateful a function closes over should be a store/wire capture, which
 * DOES reunite; then every rebound copy sees the same live state.
 */
/** Register a hoisted-function factory under its build tag (module path + export name).
 *  Called by the generated module; runs wherever that chunk loads (server AND island bundles). */
export declare function __register_fn(tag: string, factory: unknown): void;
/** Is this a transportable (og.$-branded) function? The drop-in setContext bridges these —
 *  the "functions never cross" law applies to BARE functions only. */
export declare function is_branded_fn(value: unknown): boolean;
/**
 * The call-site rewrite target: build the LIVE function for this side (the factory's module is
 * imported right there, so it is always registered) and brand it with its travel handle. The
 * host renders with a real function; if it crosses a boundary, the brand is what travels.
 */
export declare function fn_handle(tag: string, bound: unknown[]): (...args: unknown[]) => unknown;
/** The hub kind: a branded hoisted function. Bare functions are NEVER claimed (the snippet kind
 *  owns SSR-freezable snippets; an unmarked function at a boundary must keep failing loudly). */
export declare function register_fn_kind(): void;
/** Devalue reducer (legacy-shaped wrapper, mirrors the other kinds). */
export declare function reduce_fn(value: unknown): {
    t: string;
    i: string;
    d: unknown;
} | undefined;
/** Devalue reviver. Functions never memoize; `remember` rides through for capture resolution. */
export declare function revive_fn(payload: {
    t: string;
    i: string;
    d: unknown;
}, remember: boolean): unknown;
/**
 * The `import.meta.og.$` rewrite target: register the hoisted factory (pull-registration —
 * the call site IS the moment the code exists) and return the LIVE bound function, branded
 * with its travel handle. One expression, no import-time side effects.
 */
export declare function __og_$(tag: string, bound: unknown[], factory: (...b: unknown[]) => unknown): (...args: unknown[]) => unknown;
