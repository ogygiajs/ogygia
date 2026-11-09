import type { PluginMacro } from './pipeline.ts';
/**
 * Run the browser-safe macro passes over one module. `source` is the current text; `macros` are the
 * plugins' browser-safe macros (content's `code` / `md`, built with the app's markdown config).
 * Returns the rewritten code and whether anything changed — the caller invalidates its own sourcemap
 * on `touched`.
 */
export declare function run_browser_macros(source: string, id: string, macros?: readonly PluginMacro[]): Promise<{
    code: string;
    touched: boolean;
}>;
