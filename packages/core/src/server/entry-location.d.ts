/** The file an entry is loaded from: its content-hashed location, else the identity itself. */
export declare function entry_src(identity: string): string;
/**
 * The runtime bootstrap for a document: the runtime's script (its location) and a preload per chunk
 * it statically imports, so they download with it. `resolve` applies the base / assets prefix (Kit's
 * `asset()`); a routeless document passes none. Empty when no runtime is built.
 */
export declare function runtime_bootstrap(resolve?: (url: string) => string): string;
