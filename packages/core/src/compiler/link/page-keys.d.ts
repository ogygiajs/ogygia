import { type AstNode } from '../parse/oxc.ts';
type Node = AstNode;
export type PageKeys = ReadonlySet<string> | 'all';
/** `'all'` with its reason: which construct, at which line. */
export type AllReason = {
    why: string;
    line: number | null;
};
/**
 * A call that hands the page to an IMPORTED helper: `getParams(page)`. The module alone cannot say
 * what the helper reads; the build resolves the specifier, summarizes the helper's export
 * ({@link summarize_export}) and folds the answer in — one level deep. A CMS app passed the page
 * to one `url`-reading helper from 149 modules; following the call pins all of them.
 */
export type PendingCall = {
    specifier: string;
    imported: string;
    arg: number;
    line: number | null;
};
export type PageKeysAnswer = {
    keys: PageKeys | null;
    reason: AllReason | null;
    pending: PendingCall[];
};
/**
 * The top-level `page.data` keys a module reads, or `'all'` when a read cannot be pinned to a
 * literal key, or `null` when the module never imports the page (nothing to ship for it).
 * `kind` picks the parser: `'svelte'` for a component source, `'script'` for `.ts` / `.js`.
 */
export declare function page_data_keys(code: string, id: string, kind: 'svelte' | 'script'): PageKeys | null;
/** The same answer with the reason an `'all'` was given (for the build report). */
export declare function page_data_keys_answer(code: string, id: string, kind: 'svelte' | 'script'): PageKeysAnswer;
/**
 * What an exported helper reads of a page handed to it as its `arg`-th parameter — the bundle-time
 * half of following `helper(page)`. `'all'` when the export is not a plain function (a re-export,
 * a class, a variable the analysis cannot follow), when the parameter is not a plain name, or when
 * the helper itself hands the page on (one level only).
 */
export type ExportSummary = PageKeys | {
    follow: string[];
    imported: string;
};
export declare function summarize_export(code: string, id: string, kind: 'svelte' | 'script', name: string, arg: number): ExportSummary;
/** Union two answers: `'all'` absorbs everything, `null` is the identity. */
export declare function merge_page_keys(a: PageKeys | null, b: PageKeys | null): PageKeys | null;
/** Does this module even mention a page-store specifier? (the transform's pre-filter) */
export declare function mentions_page_store(code: string): boolean;
export declare function parse_roots(code: string, id: string, kind: 'svelte' | 'script'): Node[] | null;
export type PendingResolver = (specifier: string, importer: string) => Promise<{
    id: string;
} | null | undefined>;
/**
 * For every module with pending `helper(page)` calls: resolve each helper, summarize its export,
 * fold the answer into the module's keys (`'all'` with a reason when the helper cannot be
 * summarized). Runs once per build, before the closure union. `read` and `resolve` are the
 * build's (fs + the bundler's resolver), threaded in so this stays testable.
 */
export declare function follow_pending_page_calls(program: {
    page_keys: Map<string, PageKeys>;
    page_key_reasons: Map<string, AllReason>;
    page_pending: Map<string, PendingCall[]>;
}, resolve: PendingResolver, read?: (file: string) => string | null): Promise<void>;
export {};
