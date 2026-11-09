/**
 * ASYNC TWINS: what Region imports where the app runs Svelte's async mode. A render that can WAIT does
 * better than one that cannot, and only async mode lets a component `await` — without it an `await`
 * does not compile. So each such component ships as a pair: the file Region imports (works anywhere)
 * and its awaiting twin, which the plugin points that import at for an app with async mode on.
 *
 *  - LateIsland → LateIslandAwait: an inline island a Kit client navigation created has no component
 *    yet; the twin awaits its load, so the navigation's update batch waits and Kit keeps the old page
 *    until the whole new one is in (without it: an empty place, then the island).
 *  - PromiseRegion → PromiseRegionAwait: a `<Region of={promise}>` — the twin awaits the promise IN the
 *    server render (Kit seeds a remote query's result, hydration awaits the same value), so the page
 *    arrives with the region in it; without it the server renders the placeholder and the browser
 *    resolves the promise after hydration.
 */
/** Region's twin imports: the file it imports → its awaiting twin (beside it). */
export declare const ASYNC_TWINS: Readonly<Record<string, string>>;
/** Does the app compile with Svelte's async mode? Read off vite-plugin-svelte's resolved options (its
 *  config plugin publishes them as `api.options`, resolved before any plugin's own configResolved). */
export declare function svelte_async_enabled(plugins: readonly {
    name?: string;
    api?: unknown;
}[] | undefined): boolean;
/** The awaiting twin a Region twin import resolves to in an app with async mode on (beside Region,
 *  whichever copy imported it), or null for any other import. */
export declare function async_twin_redirect(source: string, importer: string | undefined, region_modules: ReadonlySet<string>): string | null;
