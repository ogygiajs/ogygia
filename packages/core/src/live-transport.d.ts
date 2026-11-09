/**
 * Transportable objects — `static [import.meta.og.wire]` codecs, as the hub's WIRE kind.
 *
 * A class instance normally cannot cross an island boundary (devalue rejects it). A class
 * opts in by declaring how it travels:
 *
 * ```ts
 * export class Cart {
 * 	items = $state<Item[]>([]);
 * 	add(item: Item) { this.items.push(item); }
 *
 * 	static wire = import.meta.og.wire({
 * 		encode: (c: Cart) => $state.snapshot(c.items),
 * 		decode: (items: Item[]) => Object.assign(new Cart(), { items })
 * 	});
 * }
 * ```
 *
 * `import.meta.og.wire()` is a COMPILE construct — the plugin consumes the member and mints the
 * key: `static [Symbol.for('ogygia.wire')] = <codec>`. No import, no value to pass around, and
 * STRICT: that member shape is the only legal position (build error anywhere else). ONE contract,
 * always explicit — `{ encode, decode }`, plus optional `id`/`merge` for session continuity.
 *
 * IDENTITY IS THE HUB'S (see ref.ts): mint memoizes one id per instance; the browser resolves
 * by id so five islands share one live object; `codec.id` names the ref into the session Keep
 * (a navigation reunites with the SAME instance, `codec.merge` reconciling fresh server data);
 * the server never remembers. This module owns only what is wire-SPECIFIC: the class registry
 * (build tag → class) and the codec protocol.
 */
/** Feature entry: register every props-seam kind, then fill the `wire` slot so core resolves
 *  ANY transportable kind from `data-ogygia-props` through the one hub key. */
export declare function install(): void;
/** Reserved key for the static codec — what `import.meta.og.wire` rewrites to. `Symbol.for` so it's
 *  identical across every bundle. Internal: the public opt-in is the construct, not this symbol. */
export declare const wire: unique symbol;
/** The codec `import.meta.og.wire({ … })` carries (or a static method returning it). */
export interface TransportCodec<T = unknown, D = unknown> {
    /** Sending side: turn the live instance into devalue-safe data. */
    encode: (value: T) => D;
    /** Receiving side: rebuild a live instance from that data. */
    decode: (data: D) => T;
    /**
     * CONTINUITY — a stable session name. Naming the codec promotes the instance from page
     * lifetime to SESSION lifetime: it becomes a singleton in this browser tab, and a navigation
     * reunites the next page's decode with the SAME live instance instead of rebuilding it. Tab-
     * scoped only — the server stays per-request (never remembers), a reload starts fresh.
     */
    id?: string;
    /**
     * Reconcile a navigation: the tab already holds the live named instance and the new page's
     * server snapshot just arrived (decoded as `fresh`). Apply whatever should carry over INTO
     * `live` — its identity is preserved; `fresh` is discarded afterwards. Default: do nothing
     * (live wins — continuity is the point; a cart mid-edit beats a server re-read). Override to
     * pull server truth in (prices, stock, auth state).
     */
    merge?: (live: T, fresh: T) => void;
}
/** Devalue custom-type name used for transportable payloads on the wire. */
export declare const TRANSPORT_WIRE_KEY = "OgygiaT";
/** Legacy wire shape (`t` tag, `i` id, `d` data) — a hub Ref minus its kind discriminator. */
interface TransportPayload {
    t: string;
    i: string;
    d: unknown;
}
/**
 * Register a class under a stable build-derived tag (root-relative module path + export
 * name). Called by generated code appended to every exported class in app source; a class
 * without a `[wire]` codec is silently skipped, so over-registration is harmless.
 */
export declare function __register_transportable(tag: string, cls: unknown): void;
/** The hub kind: `[og.wire]` class instances. Identity/reunify/Keep live in the hub. */
export declare function register_wire_kind(): void;
/**
 * Devalue reducer: encode a transportable instance, or return undefined to fall through to
 * devalue's normal handling. Same instance → same wire id (hub-memoized), which is what lets
 * the client reunite every copy of the prop into one live object.
 */
export declare function reduce_transportable(value: unknown): TransportPayload | undefined;
/**
 * Devalue reviver: rebuild a live instance from the wire payload via the hub.
 * `remember: true` (browser) memoizes by wire id + honors the session Keep; `remember: false`
 * (server, defer/streaming renders) always decodes fresh — per-request isolation.
 */
export declare function revive_transportable(payload: TransportPayload, remember: boolean): unknown;
export {};
