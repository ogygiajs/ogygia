import type { Profiler } from '../driver.ts';
/** A plugin's `import.meta.og.<name>` macro (registered with `b.macro`). */
export interface PluginMacro {
    name: string;
    handler: (code: string, m: {
        id: string;
        rel: string;
        root: string;
        markupExts: readonly string[];
    }) => string | Promise<string>;
}
export interface MacroPipelineCtx {
    root: string;
    /** Resolved Vite aliases the `bake` pass hands to its mini-bundler. */
    resolveAlias: unknown[];
    /** ogygia's own package root — auto-brand skips ogygia source. */
    pkgRoot: string;
    /** Filled with every `import.meta.og.$` hoist (tag → factory source) for the fn-manifest emit. */
    dollarHoists: Map<string, string>;
    /** The plugins' macros, in plugin order (after core's, before `bake`). */
    macros?: readonly PluginMacro[];
}
/**
 * Run the ordered macro passes over one module. `source` is the CURRENT text (a content-preset tag
 * or an earlier pass may already have edited it upstream) — never the raw file — because each pass
 * feeds the next. Returns the rewritten code and whether anything changed.
 */
export declare function run_module_macros(source: string, id: string, ctx: MacroPipelineCtx, profiler: Profiler): Promise<{
    code: string;
    touched: boolean;
}>;
