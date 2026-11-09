/** This package's root (the plugin runs from `dist/vite/`, so `../..` is the package root). A NATIVE
 *  path (backslashes on Windows): for the file system, never to compare against a module id. */
export declare const PKG_ROOT: string;
/** This package's version, as installed (the runtime discloses it: runtime/disclose-version.ts). */
export declare const OGYGIA_VERSION: string;
/** A native path as Vite writes module ids: symlinks resolved (pnpm), forward slashes (Windows). */
export declare function real_posix(p: string): string;
/** A native directory as the PREFIX of the module ids inside it: `real_posix` + one trailing `/`, so a
 *  `startsWith` never matches a sibling (`ogygia-x/`) and holds on Windows, where the native path has
 *  backslashes and Vite's ids do not. */
export declare function id_dir(p: string): string;
/** THE own-package test: every module id inside this package starts with this. Every check of "is
 *  this id ogygia's own file" compares against it, never against PKG_ROOT. */
export declare const PKG_ROOT_ID: string;
/** An island file as an `optimizeDeps.entries` pattern, or null for one of ogygia's OWN islands (the
 *  profiler UI): ogygia is in `optimizeDeps.exclude`, so the scanner can't resolve inside it, and one
 *  unresolved import fails the whole scan (nothing pre-bundles). Its client deps are named up front
 *  instead (the plugin's `dev_island_deps`). */
export declare function scan_entry_pattern(file: string, own_root?: string): string | null;
/** The two ogygia self-imports the transform injects into hosts / generated island modules. */
export declare const OGYGIA_INJECTED_IMPORTS: Set<string>;
/** ogygia's `Region.svelte` — either copy, as the POSIX id Vite hands the transform hook (a workspace
 *  can load the src one and the dist one both): its LateIsland import is the awaiting one where the
 *  app runs Svelte's async mode (late-island.ts). */
export declare const OGYGIA_REGION_MODULES: ReadonlySet<string>;
export declare const OGYGIA_INJECTED_FILES: Record<string, string>;
/** Client-side shims aliased for island modules (Kit's client runtime is absent under csr=false). */
export declare const APP_SHIMS: {
    '$app/state': string;
    '$app/stores': string;
    '$app/navigation': string;
};
/** On-disk stub for `virtual:ogygia/client-binding-stub` (csr=false client hosts). */
export declare const CLIENT_BINDING_STUB_FILE: string;
export declare const STUB_CLIENT: string;
export declare const STUB_STATE: string;
export declare const STUB_PATHS: string;
export declare const KIT_REMOTE_CLIENT: RegExp;
export declare const KIT_REMOTE_STATE: RegExp;
/** Absolute path to real HMAC (SSR-only via `virtual:ogygia/sign`). */
export declare const HMAC_MODULE: string;
/** The prebuilt runtime dir the runtime chunk bundles (for `generateRuntimeEntrySource`). */
export declare const RUNTIME_DIR: string;
/** Absolute path to SSR region-endpoint helper (signed capability URLs). */
export declare const REGION_ENDPOINT_MODULE: string;
/** The runtime chunk's source-content hash (the immutable-filename base; feature hash rides on top). */
export declare const RUNTIME_HASH: string;
