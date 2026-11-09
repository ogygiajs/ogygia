/**
 * csr=false FOUC without dual-owning island component JS.
 *
 * Kit only links stylesheets from the *client* page graph. Importing the authored `.svelte`
 * for that purpose (0.4.1) puts the same default-export module in the page graph and the
 * `emitFile` island entry → Rolldown thin-facades `og-region.*`.
 *
 * Hosts instead import `virtual:ogygia/fouc-css/<encoded>.js` which side-effect-imports:
 *   - plain `.css` files reachable from the entry
 *   - `virtual:ogygia/fouc-scoped/<encoded>.css` for each `.svelte` with a `<style>` block
 * Aggregator ids end in `.js` and scoped ids in `.css` so vite-plugin-svelte / Vite classify
 * them correctly (never as `.svelte` components). Scoped CSS is compiled with the real
 * filename so hashes match SSR.
 */
export declare const FOUC_CSS_PREFIX = "virtual:ogygia/fouc-css/";
export declare const FOUC_SCOPED_PREFIX = "virtual:ogygia/fouc-scoped/";
/** @param relPosix */
export declare function foucCssVirtualId(relPosix: string): string;
/** @param relPosix */
export declare function foucScopedVirtualId(relPosix: string): string;
/** @param id */
export declare function isFoucCssId(id: string): boolean;
/** @param id */
export declare function isFoucScopedId(id: string): boolean;
/** @param id */
export declare function foucRelFromId(id: string): string | null;
/**
 * Resolve a static import specifier against an importer file + `$lib`.
 * @param spec
 * @param importerAbs
 * @param libDir
 */
/** One resolved Vite alias (`resolve.alias`, normalized) — Kit's `kit.alias` entries arrive here. */
export interface FoucAlias {
    find: string | RegExp;
    replacement: string;
}
export declare function resolveFoucImportSpec(spec: string, importerAbs: string, libDir: string, alias?: readonly FoucAlias[]): string | null;
/**
 * Collect side-effect import specs that pull island CSS into the client graph without JS.
 * @param entryAbs absolute path to the island entry `.svelte`
 * @param opts
 */
export declare function buildFoucCssModuleSource(entryAbs: string, opts: CssReachOptions): Promise<string>;
/**
 * The transitive CSS-reachability walk under `buildFoucCssModuleSource`, exported on its own for the
 * server-router CSS registry (link/router-css.ts): from a component entry, in DISCOVERY ORDER (the
 * cascade order the aggregator has always imported in), every `.svelte` with a `<style>` block
 * (`kind: 'scoped'`) and every plain style-file import (`kind: 'css'`) reachable through the
 * component tree. Abs paths. Same resolution rules as the aggregator, so both stay in lockstep.
 */
export interface CssReachOptions {
    root: string;
    libDir: string;
    readFile?: (p: string) => string | null;
    /** app aliases to follow (`$lib_x/…`, `@scope/pkg/…` → source dirs) — the fallback resolver's */
    alias?: readonly FoucAlias[];
    /**
     * The bundler's own resolver (Vite's `this.resolve`): a package specifier through its `exports`
     * (a TypeScript entry included), a workspace link, an alias — whatever the build resolves. Without
     * it (a unit test, a host with no bundler) `$lib`, relative paths and `alias` only.
     */
    resolve?: (spec: string, importer: string) => Promise<string | null>;
}
/**
 * THE CSS A COMPONENT TREE REACHES — every `.svelte` with a `<style>` block (`kind: 'scoped'`) and
 * every plain style-file import (`kind: 'css'`), in DISCOVERY ORDER (the cascade order the aggregator
 * has always imported in). Abs paths.
 *
 * A subtree no client chunk carries (a server-only hole, a router page, a lake) gets its CSS from
 * here, so this walk must reach what the bundler reaches — a component imported through a workspace
 * package's TypeScript barrel came back unstyled: its specifier was not resolved, and a `.ts` module
 * was a dead end. So:
 * - specifiers resolve through the bundler's resolver (`opts.resolve`) when the build has one;
 * - a `.svelte` file is a component: all of it renders, so every import of it is followed;
 * - a script module is followed by the NAMES taken from it: through a barrel (the debarrel index —
 *   nested barrels, `export *`), each name to its leaf, so a barrel of twenty components brings the
 *   CSS of the two imported; a module with code of its own, every import it makes (its code may
 *   render them). A dependency's own JavaScript (`node_modules`, not a barrel) is not walked: a
 *   package ships compiled code, its components as `.svelte` files a barrel names.
 */
export declare function collectFoucCssReachable(entryAbs: string, opts: CssReachOptions): Promise<Array<{
    kind: 'scoped' | 'css';
    abs: string;
}>>;
/**
 * Compile scoped CSS for a `.svelte` file (filename must match SSR for hash stability).
 * @param abs
 * @param source
 */
export declare function compileFoucScopedCss(abs: string, source: string, opts?: {
    /** Keep the `<script>` (already free of TS/dialects): a template reading `$store` from an
     *  imported store, or any script-declared name, only compiles WITH its script. Stripping it
     *  throws on such a template and falls back to UNSCOPED style bodies — which match nothing
     *  the SSR'd markup carries. Without it (a source that may still carry TypeScript), the
     *  source is tried whole first (Svelte reads `lang="ts"` itself), then script-stripped. */
    keepScript?: boolean;
}): string;
/** @param source */
export declare function svelteHasStyle(source: string): boolean;
/**
 * Static import sources from a Svelte file's script blocks (default + side-effect).
 * @param source
 * @param filename
 */
/** A component's static imports: each specifier with the names it takes (`*` for a namespace;
 *  none for a bare `import 'x'`). Type-only imports are left out: they bring nothing at runtime. */
export declare function listStaticImports(source: string, filename: string): Array<{
    source: string;
    names: Set<string>;
}>;
