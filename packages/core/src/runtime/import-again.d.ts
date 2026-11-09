/** Whether `error` is a dynamic import that failed to load (any engine's wording), not an error the
 *  module threw as it ran. */
export declare function is_failed_import(error: unknown): boolean;
/**
 * The URL a failed dynamic import names, if it names one we can load again (http(s), this origin).
 * WebKit names none: there `known`, the file the caller imported, is it (#383).
 */
export declare function failed_import_url(error: unknown, known?: string): string | null;
/** `url` with its retry mark: a URL the module map has not seen. */
export declare function retry_url(url: string, attempt: number): string;
/** The status of the response the browser's resource timing holds for `url` (0 where the browser does
 *  not say), or `null` when none came: a download that failed (or no timing for it). */
export declare function response_of(url: string): number | null;
/** The boot hands over its message for a chunk no retry can load. Said once per page (for the first
 *  such chunk: one reload loads them all). */
export declare function on_reload_needed(say: (url: string, error: unknown) => void): void;
/**
 * `load` (a bundler-resolved `() => import('./x.ts')`), and after it fails to download, the same
 * file under a fresh URL on each later call; once it has loaded, every later call is that load (a
 * fresh URL after a success would be a second copy of the module). A retry whose own file came and
 * still failed is a dependency's failure, which no URL fixes: from then on every call fails at once
 * with its error, asking nothing. Pair it with `flights()` from `@ogygia/machine`, which calls it
 * again on a failure and never keeps one.
 */
export declare function import_again<T>(load: () => Promise<T>, fresh?: (url: string) => Promise<unknown>, 
/** The file `load` imports, when the caller knows it: what a failure that names no URL (WebKit)
 *  failed to load. */
known?: string): () => Promise<T>;
/**
 * The module at `url` (an island's own file), through {@link import_again}: a download that fails is
 * asked for again at once under a fresh URL, and by every later load of that file. A plain
 * `import()` of it once left an island whose file dropped one download dead for the tab (#261). A
 * file the server answered for (a 404 after a deploy) is not asked for again at once: the caller's
 * own recovery (./entry-locations.ts, the current build's file) is what helps there.
 */
export declare function import_file<T>(url: string): Promise<T>;
