// ../../../../node_modules/.pnpm/@sveltejs+kit@2.70.2_@opentelemetry+api@1.9.1_@sveltejs+vite-plugin-svelte@7.2.0_svelte_2ce614995eed84b42ffc972a2513643c/node_modules/@sveltejs/kit/src/runtime/app/paths/internal/server.js
var base = "";
var assets = base;
var app_dir = "_app";
var initial = {
	base,
	assets
};
/**
* `base` could be overridden during rendering to be relative;
* this one's the original non-relative base path
*/
var initial_base = initial.base;
/**
* @param {{ base: string, assets: string }} paths
*/
function override(paths) {
	base = paths.base;
	assets = paths.assets;
}
function reset() {
	base = initial.base;
	assets = initial.assets;
}
var building = false;

export { assets as a, base as b, app_dir as c, building as d, initial_base as i, override as o, reset as r };
//# sourceMappingURL=internal.js-NlsCutcl.js.map
