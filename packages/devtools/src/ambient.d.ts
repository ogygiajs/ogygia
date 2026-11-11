// Ambient declarations for what this package reads from ogygia's build: the virtual modules the
// ogygia Vite plugin serves (generated from core's virtual-module table, one file per realm), its
// compile-time constants, and the dev-only window maps. Not shipped (tsdown skips `.d.ts`).

// oxlint-disable typescript/triple-slash-reference -- ambient module declarations are global: an import would make this file a module
/// <reference path="../../core/virtual/server.d.ts" />
/// <reference path="../../core/virtual/boot.d.ts" />
// oxlint-enable typescript/triple-slash-reference

/** DEVTOOLS event layer gate (Vite `define`; default OFF — see `ogygia({ devtools })`). */
declare const __OGYGIA_DEVTOOLS__: boolean;
/** a build with devtools on: launcher only; the dock and the page measuring start once opened */
declare const __OGYGIA_DEVTOOLS_LAZY__: boolean;
/** the profiler's browser half ships (the profiler or devtools is configured) */
declare const __OGYGIA_BEACON__: boolean;

interface Window {
	// Dev-only devtools maps the dock fetches from the plugin's `/__ogygia_devtools_meta` middleware.
	// `names`: island id → component name (tab labels). `bytes`: island id → transitive dev-module
	// size (the Bytes tab's real-cost estimate). Absent off a devtools build.
	__ogygia_region_names?: Record<string, string>;
	__ogygia_region_bytes?: Record<
		string,
		{
			bytes: number;
			modules: number;
			top?: { file: string; bytes: number }[];
			barrels?: { file: string; fanout: number }[];
		}
	>;
}
