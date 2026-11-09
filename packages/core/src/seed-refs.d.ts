import type { SeedPath } from './seed-ref-reviver.ts';
export { SEED_REF_KEY, resolve_seed_ref, seed_ref_reviver, type SeedPath } from './seed-ref-reviver.ts';
/** Exact structural equality for the shapes `hash_subtree` accepts — the check behind a hash hit. */
export declare function deep_equal_plain(a: unknown, b: unknown): boolean;
/** What one walk learns about a subtree. */
export interface Measure {
    /** Byte estimate of the subtree's serialized form (a threshold input, not an exact count). */
    readonly bytes: number;
    /** Referenceable: plain objects / arrays / plain leaves only, no cycle — a seed ref may point
     *  at it and the client reads it back as the same plain data. */
    readonly ref: boolean;
    /** JSON-exact: `JSON.stringify` + `JSON.parse` reproduce it — no undefined, Date, bigint,
     *  non-finite number, -0, class instance, Map/Set, cycle. What picks the JSON lane. */
    readonly json: boolean;
    /** A thenable somewhere inside (a streamed load promise the handle must stage or settle). */
    readonly thenable: boolean;
}
/** Per-node measures: plain object / array → packed measure. Shared across every root measured in
 *  one request (the handle installs a reader); a fresh one per root outside a request. */
export type MeasureMemo = Map<object, number>;
type MemoReader = () => MeasureMemo | null;
/** Server (`hooks.ts`) installs a request-scoped reader: every root measured during one request
 *  shares one memo, so a subtree reached from two roots (the seed and an island's props) is walked
 *  once. `null` uninstalls; off-request (a hole endpoint, a test) each root gets its own memo. */
export declare function set_measure_memo_reader(fn: MemoReader | null): void;
/** What one walk says about a value (see {@link Measure}). */
export declare function analyze(value: unknown): Measure;
/**
 * WHY a tree is not JSON-exact: the path of the first leaf that disqualifies it, with what it
 * is — `config.updated (Date)`, `rows[3].price (NaN)`, `facets (Map)`, `meta (class Foo)`. A
 * separate walk on purpose (the measuring walk carries no paths); the handle runs it only for a
 * tree that left the JSON lane and only while the profiler records. `null` for a JSON tree.
 */
export declare function json_culprit(value: unknown, max_depth?: number): string | null;
/**
 * The seed's `data` indexed for referencing: every referenceable node at or above `min_bytes`, by
 * identity now and by structural hash on demand (first occurrence wins — the shortest path is not
 * guaranteed, the first in key order is, which is deterministic). It reads the one measuring walk
 * (`analyze`) and prunes: a node below `min_bytes` cannot hold a child at or above it (a child is
 * never larger than its parent), so its subtree is skipped BEFORE anything is materialised — on a
 * CMS tree that is most of the nodes. Data that is not a plain object or array indexes nothing.
 */
export declare class SeedIndex {
    #private;
    /** nodes indexed (for tests / devtools). */
    readonly size: number;
    /**
     * SEED SHAPING: the top-level `page.data` keys under which a props node was matched
     * (`plan_seed_refs` records the first path segment of every reference it plans). The handle
     * renders the tail against the FULL index, then ships every touched key — a key no island's
     * code reads but whose node an island's props point into still ships, so a reference always
     * has something to point at.
     */
    readonly touched: Set<string>;
    /** The index of `data`, cached per `data` object: one index per request, however many islands
     *  ask. */
    static of(data: unknown, min_bytes?: number): SeedIndex;
    constructor(data: unknown, min_bytes: number);
    /** node → its path from `page.data` (identity matches: the app passed the seed's own object).
     *  The path is materialised on the first ask — an indexed node that no island references
     *  never allocates one. */
    path(node: object): SeedPath | undefined;
    /** Whether `node` is an indexed seed node (by identity). */
    has(node: object): boolean;
    /**
     * The seed nodes with exactly this byte estimate — the only ones a props node of that size can
     * be a clone of. Structure matching hashes just those few candidates (memoised per seed node)
     * instead of the whole seed, so an app that passes the seed's own objects never hashes a seed
     * node at all, and a cloning app hashes only what it has to. The buckets are built on the first
     * ask — a page whose islands only pass seed objects by identity never builds them.
     */
    candidates(bytes: number): readonly object[];
    /**
     * The first seed node of exactly this byte estimate whose structural hash is `hash` (bucket
     * order, as `candidates(bytes).find(...)` gives it), in one map lookup. The bucket is hashed in
     * order only as far as an ask needs, each hash keeping its first node, so the many same-sized
     * records of a list cost one hash each however many props nodes ask.
     */
    match(bytes: number, hash: string): object | undefined;
    /** Structural hash of an indexed seed node, memoised for the request. */
    hash_of(node: object): string | null;
}
export interface SeedRefPlan {
    /** The devalue reducer for the `OgygiaSeedRef` type: `(value) => path | undefined`. */
    reducer: (value: unknown) => SeedPath | undefined;
    /** How many props nodes will cross as references (0 = serialize the canonical text instead). */
    count: number;
    /** The top-level `page.data` keys the references point into (this island's share of `touched`). */
    keys: Set<string>;
}
/**
 * Plan one island's references: walk the props once, top-down, largest matching ancestor first —
 * identity first (a pointer lookup per node, no hashing), then structure (hash + exact comparison,
 * only for a large plain node the seed does not own, and only against the seed nodes of exactly the
 * same byte size — usually none, or one). Nodes under a matched ancestor are never visited (they
 * ride inside the reference), and neither is anything under a node below `min_bytes` (no child
 * of it can be referenced). The props' own measures come from the request memo, so the plan adds
 * no walk of its own beyond the pointer lookups.
 * @heisenbench linear in props
 */
export declare function plan_seed_refs(index: SeedIndex, props: unknown, min_bytes?: number): SeedRefPlan;
