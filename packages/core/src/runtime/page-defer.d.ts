export { PAGE_DEFER_BOOTSTRAP } from '../page-defer.ts';
/** Reviver: a defer marker `[id]` becomes a real Promise, pending until its resolve script lands (or
 *  already-resolved if the resolve raced ahead of the seed). */
export declare function create_deferred(id: number): Promise<unknown>;
/** Install the live resolver (which parses the encoded value) and drain anything the inline bootstrap
 *  queued before the runtime loaded. `extra_revivers` are the app's transport decoders (custom types in
 *  a streamed value). Idempotent — safe to call on every boot; the first call's revivers win. */
export declare function install_page_defer(extra_revivers?: Record<string, (payload: never) => unknown>): void;
/** devalue reviver map for the page seed. A DEFER marker becomes a pending Promise (streaming path); a
 *  SETTLED marker becomes an already resolved/rejected Promise (non-navigate path). Both keep
 *  `page.data.x` a Promise, so `{#await}` works identically regardless of how the page was requested.
 *  `extra` merges the app's transport decoders; ogygia's own keys always win on any name clash. */
export declare function page_defer_revivers(extra?: Record<string, (payload: never) => unknown>): Record<string, (payload: never) => unknown>;
