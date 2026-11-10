/**
 * THE BROWSER'S STAND-INS for the server's half of a region's render (./region-server.ts), typed
 * against it: what `Region.svelte` and `context.ts` get from `#region-server` in the browser
 * (package.json `imports`, the `browser` condition). The browser reads nothing of the server's:
 * the server's HTML already carries every hint, link and address, so each reader answers "none".
 */
import type * as Server from './region-server.ts';
import { OgygiaError } from './messages/core.ts';

const none = (): null => null;
const empty = (): string[] => [];
const blank = (): string => '';

export const regionDeps: typeof Server.regionDeps = empty;
export const regionCss: typeof Server.regionCss = empty;
export const regionCssInline: typeof Server.regionCssInline = none;
export const contentCss: typeof Server.contentCss = empty;
export const regionReadsPage: typeof Server.regionReadsPage = () => false;
export const regionPageKeys: typeof Server.regionPageKeys = none;
export const regionRemotes: typeof Server.regionRemotes = none;
export const regionInteractivity: typeof Server.regionInteractivity = none;
export const entryLocation: typeof Server.entryLocation = none;
export const makeRegionEndpoint: typeof Server.makeRegionEndpoint = blank;
export const mintServerRegion: typeof Server.mintServerRegion = blank;
export const knownRegionFps: typeof Server.knownRegionFps = () => new Set();
export const regionFingerprint: typeof Server.regionFingerprint = blank;
export const holeCss: typeof Server.holeCss = empty;
export const getRequestEvent: typeof Server.getRequestEvent = () => {
	throw new OgygiaError('request_event_server_only');
};
// csr=true routes: the browser reads the same signal from `kit_hydrates_page()`
export const csrTrueRoutes: typeof Server.csrTrueRoutes = new Set();
export const errorCsrTrueRoutes: typeof Server.errorCsrTrueRoutes = new Set();
export const rootLayoutCsrTrue: typeof Server.rootLayoutCsrTrue = true;
export const runtime_bootstrap: typeof Server.runtime_bootstrap = blank;
export const region_css_tag: typeof Server.region_css_tag = blank;
