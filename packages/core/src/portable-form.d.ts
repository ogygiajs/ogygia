/**
 * THE PORTABLE FORM of a live region snippet — swapped in only where the snippet CROSSES.
 *
 * A `{#snippet}` handed to a component that may carry it into an island is branded at its definition
 * site (region-snippet.ts `og_portable`), but it stays the snippet as written: rendered where it is
 * written it runs in place, in the host's tree — the host's context, its scoped CSS, and any island
 * inside it a plain page island. Only a boundary needs the other shape: the body compiled to its own
 * entry, rendered in isolation on the server and hydrated alone on the client. That shape rides on the
 * snippet as `__ogPortable`, and the ONE thing that knows a value is crossing — the code preparing an
 * island's props (or a server-picked region's) for its render and its wire — swaps it in here, so the
 * server markup and the client's revived snippet are the same shape.
 *
 * Leaf module (no svelte imports): region.ts reaches it on both legs.
 */
/** Where a branded snippet carries its portable form. */
export declare const PORTABLE_FORM = "__ogPortable";
/**
 * `value` with every branded snippet in it (at any depth of plain objects and arrays) replaced by its
 * portable form. Copy-on-write: returns the SAME object when nothing in it is branded, and never
 * mutates the input.
 */
export declare function with_portable_forms<T>(value: T): T;
