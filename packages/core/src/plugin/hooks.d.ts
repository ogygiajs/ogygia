/** The shared hooks. Each is optional on a plugin; the signature is the contract. */
export interface ServerHooks {
    /** Drop every stored page carrying any of `tags` (a peer said they are stale). Never re-announced. */
    invalidate(tags: string[]): void | Promise<void>;
    /** Stored pages were dropped: `tags` names what (`p:<path>`, `s:<source>:<fp>`), or `'all'`. */
    invalidated(tags: string[] | 'all'): void | Promise<void>;
    /** Record `version` as the build the shared store last saw; answer the one before (or undefined). */
    lastBuild(version: string): string | undefined | Promise<string | undefined>;
}
/** Core only: a set of hook implementations joins (a plugin's server half, or core's own). Keyed by
 *  identity; returns the leave. */
export declare function register_hooks(impl: object): () => void;
export type Notify = {
    [K in keyof ServerHooks]: (...args: Parameters<ServerHooks[K]>) => Promise<void>;
};
export type Ask = {
    [K in keyof ServerHooks]: (...args: Parameters<ServerHooks[K]>) => Promise<Awaited<ReturnType<ServerHooks[K]>> | undefined>;
};
/** Every implementation of the named hook runs; a failing one is logged and does not stop the
 *  others. Once all ran, the notify rejects with what failed (the one error, or an
 *  AggregateError): "done" and "done, but one could not" are different answers, like the ask's
 *  (a peer said done for a thaw its store failed to apply, #287). */
export declare const notify: Notify;
/** The first implementation that answers something other than `undefined`. When none answered and
 *  one threw, the ask throws that error: "nobody knows" and "the one who knows could not say" are
 *  different answers (a store down once read as "no store", and the deploy thaw was lost, #198). */
export declare const ask: Ask;
