import type { ViteDevServer } from 'vite';
export declare const DEV_MAPS: unique symbol;
export declare const DEV_PAGE_KEYS: unique symbol;
/** what an island's code reads of `page.data`, as the build would say: its keys, or `'all'` with
 *  the lines that make it so; `null` when nothing in it reads the page */
export interface DevPageKeys {
    keys: string[] | 'all' | null;
    why: {
        file: string;
        line: number | null;
        why: string;
    }[];
}
/**
 * THE BUILD'S SEED ANSWER, ON THE DEV SERVER: the build pins which `page.data` keys each island's
 * code reads (seed shaping); the dev server does not — every island reads "everything" there, so
 * the profiler could not tell a late island's data or point at the line that ships it all. This
 * puts the same analysis behind a global the profiler (same process) asks: the island id's
 * component and the app modules it imports (the SSR graph, eight deep), each read by the build's
 * own `page_data_keys_answer`, a helper handed the page followed one level like the build does.
 * Only what the report says changes: the dev seed itself still ships whole.
 */
export declare function install_dev_page_keys(server: ViteDevServer, component_of: (iid: string) => string | null | undefined, root: string): void;
/**
 * THE BROWSER'S MODULES, TOO: a CPU trace from the browser names a frame by the URL the dev server
 * served (`/src/lib/Save.svelte?t=…`) at the SERVED code's lines — a `.svelte` file's compiled output,
 * not its source. The client module graph holds each served module's map (the browser runs the code
 * as served: no header to shift by). Looked up by the URL's path, then with its query minus Vite's
 * `t=` / `v=` stamps (a virtual island id keeps its own query).
 */
export declare const DEV_CLIENT_MAPS: unique symbol;
export declare function install_dev_client_maps(server: ViteDevServer): void;
export declare function install_dev_maps(server: ViteDevServer): void;
