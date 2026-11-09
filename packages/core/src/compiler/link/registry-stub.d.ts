export declare const REGISTRY_STUB_PREFIX = "virtual:ogygia/registry-stub/";
/** The query that names a registry's client-leg variant (its marks blanked, everything else kept). */
export declare const REGISTRY_CLIENT_QUERY = "?og-registry-client";
/** The client-leg variant id of a registry: its real absolute path (relative imports resolve from
 *  the registry's own directory) plus {@link REGISTRY_CLIENT_QUERY}. */
export declare function registry_client_id(abs_path: string): string;
/** The registry path a client-leg variant id names, or `null` for any other id. */
export declare function registry_client_path(id: string): string | null;
/**
 * The static VALUE import specifiers of a script module — `import … from`, side-effect `import '…'`,
 * `export … from`, `export * from` (type-only forms skipped; dynamic `import()` skipped: Kit links
 * no CSS for a node's dynamic chunks). `null` when the module does not parse.
 */
export declare function static_script_specs(source: string, file: string): string[] | null;
/**
 * The registry's source with its MARKS blanked and everything else kept, or `null` when it does not
 * parse (the caller falls back to the names-only stub). A mark is an import whose `with { … }`
 * carries a region key (`region_keys`: the app's wake / render / region / preset names), or a
 * component handed to `import.meta.og.asRegion(…)`. Each blanked binding becomes
 * `const X = undefined` so the module still links; the client leg never runs it anyway.
 */
export declare function registry_client_source(source: string, file: string, region_keys: ReadonlySet<string>): string | null;
/** Root-relative posix path → the stub id. `names` are the exports the stub must declare. */
export declare function registry_stub_id(rel_posix: string, names: Iterable<string>): string;
/** True for a (resolved or bare) stub id. */
export declare function is_registry_stub_id(id: string): boolean;
/** The export names a stub id carries (`default` included when the registry has one). */
export declare function registry_stub_names(id: string): string[];
/** The stub module's source: every name as `undefined`, so the host links and nothing is shipped. */
export declare function registry_stub_source(names: readonly string[]): string;
/**
 * The names a module exports, scanned from its source (declarations, `export { a, b as c }`,
 * `export default`). A textual scan — registries are plain TypeScript lists, and a name the scan
 * misses is covered by {@link imported_names} (what the host actually asks for).
 */
export declare function export_names(source: string): Set<string>;
/**
 * The names `importer_source` imports from `spec` (default → `default`, named → their exported
 * names, `* as ns` → nothing extra: a namespace import links against whatever the stub declares).
 */
export declare function imported_names(importer_source: string, spec: string): Set<string>;
