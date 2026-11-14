/**
 * THE BROWSER'S STAND-INS for the server's half of a region's render (./region-server.ts), typed
 * against it: what `Region.svelte` and `context.ts` get from `#region-server` in the browser
 * (package.json `imports`, the `browser` condition). The browser reads nothing of the server's:
 * the server's HTML already carries every hint, link and address, so each reader answers "none".
 */
import type * as Server from './region-server.ts';

const none = (): null => null;
const empty = (): string[] => [];
const blank = (): string => '';

export const region_deps: typeof Server.region_deps = empty;
export const region_css: typeof Server.region_css = empty;
export const region_css_inline: typeof Server.region_css_inline = none;
export const content_css: typeof Server.content_css = empty;
export const region_reads_page: typeof Server.region_reads_page = () => false;
export const region_page_keys: typeof Server.region_page_keys = none;
export const region_remotes: typeof Server.region_remotes = none;
export const region_interactivity: typeof Server.region_interactivity = none;
export const entry_location: typeof Server.entry_location = none;
export const make_region_endpoint: typeof Server.make_region_endpoint = blank;
export const mint_server_region: typeof Server.mint_server_region = blank;
export const reuse_known_region: typeof Server.reuse_known_region = () => false;
export const region_fingerprint: typeof Server.region_fingerprint = blank;
export const hole_css: typeof Server.hole_css = empty;
// (the link alone, as a production message prints: importing the message tables here would add a
// module to every page that renders a region in the browser, and move its chunks)
export const get_request_event: typeof Server.get_request_event = () => {
	throw new Error('[ogygia] https://ogygiajs.dev/e/request_event_server_only');
};
// csr=true routes: the browser reads the same signal from `kit_hydrates_page()`
export const csr_true_routes: ReadonlySet<string> = new Set();
export const error_csr_true_routes: ReadonlySet<string> = new Set();
export const root_layout_csr_true: typeof Server.root_layout_csr_true = true;
export const runtime_bootstrap: typeof Server.runtime_bootstrap = blank;
export const region_css_tag: typeof Server.region_css_tag = blank;
export const head_owner_attr: typeof Server.head_owner_attr = blank;
