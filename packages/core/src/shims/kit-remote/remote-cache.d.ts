/** SSR-resolved remote response maps shared by Kit remote-functions + ogygia SPA reset. */
type RemoteNode = {
    v?: unknown;
    e?: [number, unknown];
};
type RemoteResource = {
    destroy?: () => void;
    refresh?: () => Promise<unknown>;
    reconnect?: () => Promise<unknown>;
};
type RemoteEntry = {
    resource?: RemoteResource;
};
/**
 * Kit remote-function response + instance cache.
 *
 * SSR seeds (`query_responses`) are cleared in `prepare_spa_document` (before
 * replaceWith). Instance maps are cleared in `finish_spa_document` (after
 * replaceWith, before async island hydrate) so a new page never reuses a
 * LiveQuery whose `#start` is already spent — Kit's `once()` wrapper would
 * never open SSE again, leaving `query.live` on "connecting…".
 */
export declare class RemoteCache {
    readonly query_responses: Record<string, RemoteNode>;
    readonly prerender_responses: Record<string, RemoteNode>;
    readonly query_map: Map<string, Map<string, RemoteEntry>>;
    readonly live_query_map: Map<string, Map<string, RemoteEntry>>;
    /** Drop SSR seed bags only (safe while old islands are still connected). */
    clear_seeds(): void;
    /**
     * Destroy leftover query/live instances and clear the maps.
     * Call only after the previous body has disconnected.
     */
    clear_instances(): void;
    /**
     * Re-fetch every live query instance in place (Kit's `refreshAll` does the same to its own maps):
     * queries refresh, live queries reconnect. Settles when all of them have.
     */
    refresh_instances(): Promise<void>;
}
export declare const remote_cache: RemoteCache;
export declare const query_responses: RemoteCache['query_responses'];
export declare const prerender_responses: RemoteCache['prerender_responses'];
export declare const query_map: RemoteCache['query_map'];
export declare const live_query_map: RemoteCache['live_query_map'];
export declare function clear_remote_seeds(): void;
export declare function clear_remote_instances(): void;
export declare function refresh_remote_instances(): Promise<void>;
export {};
