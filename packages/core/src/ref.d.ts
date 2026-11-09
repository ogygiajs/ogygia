/**
 * THE HUB — ogygia's identity layer. One primitive carries everything that crosses an
 * island boundary:
 *
 *     Ref = { k: kind, i: identity, t: code tag, d: data }
 *
 * A held region, a portable snippet, a store, a `[og.wire]` class, a hoisted function —
 * each is a Ref of a different KIND. A kind teaches the hub how its values travel
 * (`match`/`encode`/`decode`); the hub owns everything identity:
 *
 *  - MINT: every live instance gets ONE id (WeakMap-memoized), however many props or
 *    context keys carry it — which is what lets the client reunite all copies.
 *  - RESOLVE: the browser memoizes decode by id (`remember: true`), so five islands
 *    decoding one handle share ONE live object. The server never memoizes
 *    (`remember: false`): each request decodes fresh — nothing leaks between users.
 *  - THE KEEP: a kind may name a ref for SESSION continuity (`keep_name`); the tab then
 *    reunites navigations with the same live instance, reconciling fresh server data via
 *    the kind's `merge`. Browser-only; the server never touches it.
 *
 * Everything interesting in the framework is an operation on `i`, not `d`: reunify across
 * islands = same id; survive a navigation = same id in the Keep; dedupe = same id; the
 * future region reconciler = diff two id sets. Kinds are plugins; identity is the spine.
 *
 * All registry state lives on `globalThis` under `Symbol.for` keys — the runtime and each
 * island entry are separate bundles, and per-module state would silently fork.
 */
/** The wire shape. `k` picks the kind, `i` is identity, `t` names code (module tag /
 *  chunk / factory), `d` is devalue-safe data (value, snapshot, props, bound captures). */
export interface Ref {
    k: string;
    i: string;
    t?: string;
    d?: unknown;
    /** Scope hint (hub v2, phase S) — which lifetime bucket governs this instance:
     *  'request' (server, never memoized) | 'page' (this render) | 'session' (cross-nav, tab).
     *  Optional on the wire; when absent, resolve derives it (keep_name ⇒ session, else the
     *  caller's page/request choice). Present so a scope can be DISPOSED as a unit (phase D). */
    sc?: Scope;
}
/** The three identity lifetimes, one axis of the hub's policy space. */
export type Scope = 'request' | 'page' | 'session';
/** A kind teaches the hub one family of transportable values. */
export interface RefKind {
    /** Kind discriminator carried in `Ref.k` ('wire' | 'store' | 'snippet' | 'region' | 'fn' | …). */
    k: string;
    /** Claim a live value (mint dispatch, first registered wins). */
    match(value: unknown): boolean;
    /** Sending side: code tag + devalue-safe data. */
    encode(value: object): {
        t?: string;
        d?: unknown;
    };
    /** Receiving side: rebuild a live value from the ref. */
    decode(ref: Ref): unknown;
    /** An id DERIVED from the descriptor, for a kind whose decode reads only `d` and whose instances
     *  hold no state: equal descriptors ARE the same value, so they may share the id — and a render
     *  mints the same id every time (the HTML, the island's fingerprint and every cache keyed on them
     *  stay put across requests). `undefined` (or no hook) → a fresh random id, as every stateful kind
     *  needs (a store, a class instance: identity is the point). */
    stable_id?(d: unknown): string | undefined;
    /** SESSION continuity: name this ref to promote its instance to tab lifetime (browser only). */
    keep_name?(ref: Ref): string | undefined;
    /** Reconcile a kept live instance with a freshly arrived ref (default: kept wins untouched). */
    merge?(kept: object, ref: Ref): void;
    /** Tear down a live instance when its scope is disposed (hub v2, phase D) — close a channel,
     *  abort a fetch, drop a subscription. Most kinds have nothing to release (GC handles the
     *  object); implement only when the instance owns a resource beyond memory. */
    dispose?(live: object): void;
}
/** Register a kind. Idempotent by discriminator — a re-registration (second bundle evaluating
 *  the same module) keeps the FIRST, so identity state never forks. */
export declare function register_kind(kind: RefKind): void;
/**
 * Mint: live value → Ref, or undefined to fall through to devalue's normal handling.
 * `only` restricts the dispatch to named kinds — a seam may deliberately exclude a family
 * (the drop-in context path excludes snippets so a stray function THROWS instead of being
 * silently mis-read as one). Same instance → same id, always.
 */
export declare function mint(value: unknown, only?: ReadonlySet<string>): Ref | undefined;
export { set_resolve_sink } from './ref-sink.ts';
/**
 * DISPOSE a whole scope (hub v2, phase D) — tear down every instance in its bucket via the
 * instance's `kind.dispose`, run any registered scope-disposers (side-effect cleanups like the
 * remote cache), then empty the bucket. `dispose_scope('page')` on nav is what replaces the old
 * MAX_LIVE cap: stale page-scoped aliases go, session/forever instances stay.
 *
 * SAFETY: a page-bucket instance that is ALSO in a longer-lived bucket (a wire class aliased into
 * 'session' for continuity) is NOT torn down — only its page alias is dropped. Its resources
 * belong to the session and outlive the nav.
 */
export declare function dispose_scope(scope: Scope): void;
/**
 * DISPOSE specific page-scoped ids (reconciler R3) — the SELECTIVE counterpart to dispose_scope.
 * A reconcile nav keeps matched islands mounted, so it can't blanket-dispose the page scope; it
 * disposes only the ids owned by REMOVED regions. Each id's instance is torn down via its
 * kind.dispose and removed from the page bucket, instance_kind, and dep_index — UNLESS it is also
 * session-aliased (continuity), in which case only nothing happens (the session bucket keeps it).
 * ids not present in the page bucket are skipped silently.
 */
export declare function dispose_ids(ids: Iterable<string>): void;
/** Register a side-effect cleanup to run whenever `scope` is disposed. Returns an unregister fn.
 *  Lets subsystems (the remote cache) fold their nav-time clearing into scope disposal. */
export declare function register_scope_disposer(scope: Scope, fn: () => void): () => void;
/**
 * Resolve: Ref → live value.
 *
 * Second arg is a {@link Scope} (or a legacy boolean shim: `true` ⇒ 'page', `false` ⇒ 'request').
 * 'page'/'session' (browser) memoize by id — decoding the same ref twice returns the SAME instance
 * (the liveness mechanism), and a kind-named ref reunites with the session bucket across
 * navigations (the kind's `merge` reconciles fresh server data in; default kept-wins). 'request'
 * (server, defer/streaming renders) always decodes fresh: memoizing across requests would leak one
 * user's state into another's HTML.
 */
export declare function resolve(ref: Ref, scope_or_remember: boolean | Scope): unknown;
export { watch, notify, batch, watcher_count } from './ref-watch.ts';
/** Resolve a bag of refs as one transaction (sugar over {@link batch}). */
export declare function resolve_batch(refs: readonly Ref[], scope: boolean | Scope): unknown[];
/** Devalue custom-type name for hub refs on the wire (the ONE key every seam will converge on). */
export declare const REF_WIRE_KEY = "OgygiaRef";
/** Devalue reducer for a seam. `only` deliberately restricts which families may cross there. */
export declare function ref_reducer(only?: ReadonlySet<string>): (value: unknown) => Ref | undefined;
/** Devalue reviver for a seam. Browser passes `remember: true`; the server must pass `false`. */
export declare function ref_reviver(remember: boolean): (ref: Ref) => unknown;
