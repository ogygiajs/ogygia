/** hooks.ts installs this once — files a receipt with the current request's facts. */
export declare function set_source_recorder(fn: ((tag: string) => void) | null): void;
/** federate() installs this once — every receipt tag. */
export declare function set_source_observer(fn: ((tag: string) => void) | null): void;
/** Called by the `__og_source` wrapper on every invocation (and by a peer handle for the tags it
 *  ADOPTS from a remote fragment). Neither seam may fail the app's own call. */
export declare function record_source_read(tag: string): void;
/** The identity stamp — read by `postrender.invalidate(fn, args)`. */
export declare const SOURCE_ID: unique symbol;
/** The optional `{ key }` canonicalizer stamp (exotic signatures). */
export declare const SOURCE_KEY: unique symbol;
export interface SourceOptions<A extends unknown[]> {
    /** Canonicalize exotic args to a stable string yourself; default = structural fingerprint. */
    key?: (...args: A) => string;
}
/** The structural fingerprint of a call's args — stable across processes and time. */
export declare function fingerprint_args(args: unknown[]): string;
/** `s:<id>:<fp>` — the receipt/eviction tag for one (source, args) pair. */
export declare function source_tag(id: string, fingerprint: string): string;
/** The compiled form of `export const X = import.meta.og.source(fn, opts?)`. */
export declare function __og_source<A extends unknown[], R>(id: string, fn: (...args: A) => R, opts?: SourceOptions<A>): (...args: A) => R;
/** A function stamped by the macro. */
type SourceFn = ((...args: never[]) => unknown) & {
    [SOURCE_ID]?: string;
    [SOURCE_KEY]?: (...args: unknown[]) => string;
};
/** The receipt tag one `(source, args)` call files, or null when `fn` is not a declared source. */
export declare function source_tag_of(fn: SourceFn, args?: unknown[]): string | null;
export {};
