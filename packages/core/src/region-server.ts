/**
 * THE SERVER'S HALF OF A REGION'S RENDER: what `Region.svelte` and `context.ts` read on the server,
 * from `ogygia:server` and the server helpers. They import it as `#region-server` (package.json
 * `imports`): on the server this module, in the browser `region-server.browser.ts`, the stand-ins
 * typed against it. The browser build never resolves `ogygia:server` (the realm check refuses it).
 */
export {
	regionDeps,
	regionCss,
	regionCssInline,
	contentCss,
	regionReadsPage,
	regionPageKeys,
	regionRemotes,
	regionInteractivity,
	entryLocation,
	makeRegionEndpoint,
	mintServerRegion,
	knownRegionFps,
	regionFingerprint,
	holeCss,
	getRequestEvent,
	csrTrueRoutes,
	errorCsrTrueRoutes,
	rootLayoutCsrTrue
} from 'ogygia:server';
export { runtime_bootstrap } from './server/entry-location.ts';
export { region_css_tag } from './server/region-css.ts';
