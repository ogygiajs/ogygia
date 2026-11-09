/**
 * PUSHABLE PROPS: the props a mounted island reads reactively, so the next value reaches it in
 * place instead of a re-hydrate — a live region's next tick, a kept island's next page. The island
 * is hydrated with `props` itself (Svelte's documented reactive-props form for `hydrate`), so
 * focus and local state survive and Svelte reconciles the view. Filled into the `Pushable` slot by
 * the live feature (./live.ts); a page with neither live nor kept regions never loads it.
 *
 * The props are a snapshot of data, as every island's are: held RAW (`$state.raw`), never deep-proxied
 * — the island reads the very values pushed (a large nav tree pays no proxy on each read, identity
 * holds, `structuredClone` works), and mutating one is no more reactive than in any other island. A
 * push replaces the whole snapshot; `props` is a plain reader over the current one, so each prop read
 * tracks it.
 */
export declare class PushableProps {
    #private;
    /** What the island is hydrated with: the current snapshot's props, read live. */
    readonly props: Record<string, unknown>;
    constructor(initial: Record<string, unknown>);
    /** The next snapshot (a live tick, the next page's props): replaces the current one whole. */
    push(next: Record<string, unknown>): void;
}
