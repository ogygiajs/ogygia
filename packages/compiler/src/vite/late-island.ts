/** Region's twin imports: the file it imports → its awaiting twin (beside it). */
export const ASYNC_TWINS: Readonly<Record<string, string>> = {
	'./LateIsland.svelte': 'LateIslandAwait.svelte',
	'./PromiseRegion.svelte': 'PromiseRegionAwait.svelte'
};

/** Does the app compile with Svelte's async mode? Read off vite-plugin-svelte's resolved options (its
 *  config plugin publishes them as `api.options`, resolved before any plugin's own configResolved). */
export function svelte_async_enabled(
	plugins: readonly { name?: string; api?: unknown }[] | undefined
): boolean {
	const api = plugins?.find((p) => p.name === 'vite-plugin-svelte:config')?.api as
		| { options?: { compilerOptions?: { experimental?: { async?: boolean } } } }
		| undefined;
	return api?.options?.compilerOptions?.experimental?.async === true;
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
