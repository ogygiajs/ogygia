/**
 * The profiler's maps, as the server build embedded them (`ogygia:server/profiler-maps`, its own
 * lazy chunk). Reached as `#profiler-maps` (package.json `imports`): on the server this module, in
 * the browser ./maps-browser.ts, so the browser build never resolves a server module.
 */
export const read_profiler_maps = (): Promise<string | null> =>
	import('ogygia:server/profiler-maps').then((m) => m.profiler_maps);
