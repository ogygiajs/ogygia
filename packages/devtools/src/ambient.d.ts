// Ambient declarations for what this package reads from ogygia's build: the virtual modules the
// ogygia Vite plugin serves (generated from core's virtual-module table, one file per realm), its
// compile-time constants, and the dev-only window maps. Not shipped (tsdown skips `.d.ts`).

// oxlint-disable typescript/triple-slash-reference -- ambient module declarations are global: an import would make this file a module
/// <reference path="../../core/virtual/server.d.ts" />
/// <reference path="../../core/virtual/boot.d.ts" />
/// <reference path="../../core/virtual/constants.d.ts" />
// oxlint-enable typescript/triple-slash-reference

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
			barrels?: import('@ogygia/insights').IslandBarrel[];
		}
	>;
}
