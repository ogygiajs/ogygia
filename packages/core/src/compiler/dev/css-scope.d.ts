/** Structural shape of a Vite dev module-graph node (the two fields the owner walk reads). */
export type DevGraphModule = {
    file?: string | null;
    importers?: Iterable<DevGraphModule>;
};
/**
 * Which top-level route scopes can reach `abs_file` — walked UP the dev module graph until route
 * files are hit. A scope is a route file's first path segment under `src/routes` (`'(docs)'`,
 * `'playground'`, `''` for a root-level route file). `[]` = no route owner found; the client treats
 * that as shared and joins anywhere (the safe default for exotic graphs).
 *
 * @internal Exported for unit tests.
 */
export declare function derive_css_scope_owners(abs_file: string, root: string, graphs: Array<{
    getModulesByFile?: (f: string) => Set<DevGraphModule> | undefined;
} | undefined | null>): string[];
