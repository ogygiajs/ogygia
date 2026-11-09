/** Record that `region`'s island resolved page id `id` (called via the resolve-sink). */
export declare function record_region_id(region: Element, id: string): void;
/** The page ids a region's island owns, or undefined. */
export declare function region_owned_ids(region: Element): Set<string> | undefined;
/** Run `fn` with the hub's resolve-sink funneling every page id it resolves to `region`'s owned
 *  set, then restore the previous sink (finally, so a throw can't strand it). Wrap an island's
 *  SYNC prop/context decode so the reconciler learns which ids that island owns. */
export declare function capture_region_ids<T>(region: Element, fn: () => T): T;
