import './async.js-BHxnfxQk.js';

// ../../../core/src/router-css.ts
var registry = /* @__PURE__ */ new WeakMap();
/** DEV registrations, keyed by the component's source path — pure DATA, no component imports.
*
*  Structural constraint (learned the hard way): the generated dev virtual must not `import` the
*  components it registers. The virtual is reachable from `ogygia/plugin/css` — which the profiler's
*  handle welds into the graph territory SvelteKit's dev "inline all styles" collector can crawl
*  from ANY page (via Kit's generated internal.js → hooks). Component imports would drag every
*  router page's whole tree — scoped styles, plain `.css` imports — into that crawl, leaking a
*  router page's stylesheets into unrelated app pages. So dev registers `path → entries` data and
*  the lookup matches through Svelte's own dev metadata instead (see `filename_of`). */
var path_registry = /* @__PURE__ */ new Map();
/** Called by the generated `virtual:ogygia/router-css` — one registration per reachable component. */
function register_router_css(component, entries) {
	if ((typeof component === "function" || typeof component === "object" && component !== null) && !registry.has(component)) registry.set(component, entries);
}
/** A dev-compiled Svelte 5 component carries its source path under svelte's `Symbol(filename)`
*  (`Comp[$.FILENAME] = '/abs/….svelte'` — dev only). Read it by symbol DESCRIPTION rather than
*  importing `svelte/internal/*`: this module is realm-shared, and pulling either internal entry
*  would drag the wrong svelte runtime into the other realm's bundle. */
function filename_of(component) {
	const sym = Object.getOwnPropertySymbols(component).find((s) => s.description === "filename");
	const v = sym ? component[sym] : void 0;
	return typeof v === "string" ? v : void 0;
}
/** The stylesheet entries for one rendered component — [] when unregistered (no styles, or the
*  component reached the router outside its modules' import graph; dev warns on that case). */
function router_css_of(component) {
	if (typeof component !== "function" && (typeof component !== "object" || component === null)) return [];
	const thunk = registry.get(component);
	if (thunk) try {
		return thunk() ?? [];
	} catch {
		return [];
	}
	if (path_registry.size) {
		const file = filename_of(component);
		if (file) return path_registry.get(file) ?? [];
	}
	return [];
}
// src/lib/r/Shell.svelte
function Shell($$renderer, $$props) {
	let { children } = $$props;
	$$renderer.push(`<div data-testid="r-shell">`);
	children?.($$renderer);
	$$renderer.push(`<!----></div>`);
}
// src/lib/r/Frozen.svelte
function Frozen($$renderer) {
	$$renderer.push(`<h1 data-testid="r-frozen">router page, frozen by its own flag</h1>`);
}
// src/lib/r/Plain.svelte
function Plain($$renderer) {
	$$renderer.push(`<h1 data-testid="r-plain">router page, undeclared — follows the config default</h1>`);
}
// src/lib/r/Off.svelte
function Off($$renderer) {
	$$renderer.push(`<h1 data-testid="r-off">router page, pure but opted out</h1>`);
}

export { Frozen as F, Off as O, Plain as P, Shell as S, register_router_css as a, router_css_of as r };
//# sourceMappingURL=Off.js-BtnpcuUx.js.map
