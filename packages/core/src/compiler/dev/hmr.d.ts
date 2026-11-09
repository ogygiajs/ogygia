/**
 * Host route shells (`+page` / `+layout` / …) never join the browser module graph under
 * `csr=false`, so Vite's fine-grained HMR for them has no client importer. Force a full reload.
 * Standalone CSS is soft-updated via `virtual:ogygia/dev-hmr` (Vite inject after Kit FOUC).
 * If that soft path fails, the client bridge listens for `vite:error` and reloads the document.
 *
 * @internal HMR policy helper (also covered by unit tests).
 */
export declare function needs_csr_false_full_reload(file: string): boolean;
/**
 * Island entry `.svelte` files (the `import X from '…' with { hydrate }`) sit behind a virtual
 * wrapper; Svelte soft HMR through that edge is unreliable. Shared `.ts` deps still soft-update.
 *
 * @internal HMR policy helper (also covered by unit tests).
 */
export declare function needs_island_entry_full_reload(file: string, entries: Iterable<{
    componentPath?: string | null;
}>): boolean;
/**
 * Absolute path equality with querystrings stripped (host vs component vs Vite watch paths).
 * @internal
 */
export declare function same_module_path(a: string | null | undefined, b: string | null | undefined): boolean;
/**
 * Virtual island ids whose generated source must be dropped when `file` changes or is deleted.
 * Island ids are `hash(componentPath\\0strategyKey)` — renaming a host route keeps the same id, so
 * Vite's moduleGraph must be invalidated or it keeps serving the old import.
 *
 * @internal HMR invalidation helper (also covered by unit tests).
 */
export declare function island_vpaths_affected_by_file(file: string, entries: Iterable<[string, {
    hostPath?: string | null;
    componentPath?: string | null;
}]>): string[];
