export declare const ROUTER_CSS_KEY_PREFIX = "rcss:";
/** The handoff css-map key for one root component (posix-rel to the app root). */
export declare function router_css_key(root: string, abs: string): string;
/**
 * The `.svelte` ROOTS of the app's router modules: BFS from every page module (`b.pageModules()`),
 * through relative/`$lib` `.ts`/`.js` re-exports (barrels — resolved as build
 * DATA, imports untouched), collecting `.svelte` leaves. `module_specs` is the prescan's import-spec
 * record (module abs path → its import/export-from specifiers). Sorted for determinism across legs.
 */
export declare function router_css_roots(router_modules: ReadonlySet<string>, module_specs: ReadonlyMap<string, readonly string[]>, lib_dir: string, exists?: (p: string) => boolean): string[];
/**
 * Emit the `virtual:ogygia/router-css` source. Empty (`export {}`) when the app has no router
 * modules — the router's dynamic import of this virtual then registers nothing, zero cost.
 */
export declare function router_css_module(roots: readonly string[], opts: {
    root: string;
    lib_dir: string;
    is_dev: boolean;
    read_file: (p: string) => string | null;
    /** the bundler's resolver, for the dev tree-CSS walk (compiler/fouc-css.ts) */
    resolve?: (spec: string, importer: string) => Promise<string | null>;
}): Promise<string>;
