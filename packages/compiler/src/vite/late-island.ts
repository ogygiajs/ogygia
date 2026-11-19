import type { SvelteCompile } from './svelte-options.ts';

/** Region's twin imports: the file it imports → its awaiting twin (beside it). */
export const ASYNC_TWINS: Readonly<Record<string, string>> = {
	'./LateIsland.svelte': 'LateIslandAwait.svelte',
	'./PromiseRegion.svelte': 'PromiseRegionAwait.svelte'
};

/** Does the app compile with Svelte's async mode? */
export function svelte_async_enabled(svelte: SvelteCompile | null): boolean {
	return svelte?.compilerOptions?.experimental?.async === true;
}

/** The awaiting twin a Region twin import resolves to in an app with async mode on (beside Region,
 *  whichever copy imported it), or null for any other import. */
export function async_twin_redirect(
	source: string,
	importer: string | undefined,
	region_modules: ReadonlySet<string>
): string | null {
	const twin = ASYNC_TWINS[source];
	if (!twin || !importer || !region_modules.has(importer)) return null;
	return importer.slice(0, importer.lastIndexOf('/') + 1) + twin;
}
