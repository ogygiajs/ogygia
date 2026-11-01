import { a1 as escape_html, O as derived } from './server.js-B9P4ExQ-.js';
import './async.js-FhULVWAw.js';
import { a_ as og_portable } from './late-region-registry.js-DXI715J1.js';
import { m as makeRegionEndpoint, r as render_region_html, R as Region } from './render-region-html.js-DsVhRg6l.js';
import { p as page } from './state.js-DXGb76jd.js';
import { _ as _416c9c898227_default } from './416c9c898227.js-BJSsvlt3.js';

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
// ../island-pkg/src/pages/PkgPage.svelte
function PkgPage($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { data } = $$props;
		$$renderer.push(`<article data-pkg-page=""><h1>Shipped route: ${escape_html(data.title)}</h1> `);
		_416c9c898227_default($$renderer, { start: 10 });
		$$renderer.push(`<!----></article>`);
	});
}
// virtual:ogygia/island/07359c6d3845.svelte
function _7359c6d3845($$renderer) {
	$$renderer.push(`<div data-region-skeleton="">crunching the slow part…</div>`);
}
// src/lib/rtr/StreamRegion.svelte
function __og_native_placeholder_0($$renderer) {
	$$renderer.push(`<div data-region-skeleton="">crunching the slow part…</div>`);
}
function StreamRegion($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { data } = $$props;
		$$renderer.push(`<h1>late-region page</h1> `);
		Region($$renderer, {
			placeholder: og_portable(__og_native_placeholder_0, _7359c6d3845, {}, "/_app/immutable/og-region.07359c6d3845.js"),
			of: data.pending
		});
		$$renderer.push(`<!---->`);
	});
}
// src/lib/rtr/Shell.svelte
function Shell($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { children, data } = $$props;
		$$renderer.push(`<div data-testid="shell"><header class="rtr-header svelte-y3psq4">APP SHELL who=${escape_html(data?.who)}</header> <div class="body">`);
		children($$renderer);
		$$renderer.push(`<!----></div></div>`);
	});
}
// src/lib/rtr/Inner.svelte
function Inner($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { children, data } = $$props;
		$$renderer.push(`<section data-testid="inner"><nav>DOCS NAV n=${escape_html(data?.nav)}</nav> <div>`);
		children($$renderer);
		$$renderer.push(`<!----></div></section>`);
	});
}
// src/lib/rtr/Badge.svelte
function Badge($$renderer) {
	$$renderer.push(`<span class="rtr-badge svelte-1m3engv">badge</span>`);
}
// src/lib/rtr/Home.svelte
function Home($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { data } = $$props;
		$$renderer.push(`<h1 data-testid="page">router home page who=${escape_html(data?.who)} `);
		Badge($$renderer);
		$$renderer.push(`<!----></h1>`);
	});
}
// src/lib/rtr/Deep.svelte
function Deep($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { data } = $$props;
		$$renderer.push(`<h1 data-testid="page">deep page saw who=${escape_html(data?.who)} nav=${escape_html(data?.nav)}</h1>`);
	});
}
// src/lib/rtr/WhoReader.svelte
function WhoReader($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		const who = derived(() => page.data.who);
		$$renderer.push(`<span data-rtr-who="">${escape_html(who())}</span>`);
	});
}
// virtual:ogygia/island/7bc802f2e6f6.js
var _7bc802f2e6f6_default$1 = WhoReader;
// virtual:ogygia/wrapper/7bc802f2e6f6.svelte
function _bc802f2e6f6($$renderer, $$props) {
	let { children, $$slots, $$events, ...__props } = $$props;
	Region($$renderer, {
		__mode: "island",
		load: true,
		__entry: "/_app/immutable/og-region.7bc802f2e6f6.js",
		__component: _7bc802f2e6f6_default$1,
		__css: WhoReader,
		__props,
		children
	});
}
// virtual:ogygia/region/7bc802f2e6f6.js
Object.assign(_bc802f2e6f6, {
	__ogRegion: "7bc802f2e6f6",
	__module: "/_app/immutable/og-region.7bc802f2e6f6.js",
	__hydrate: "load",
	__component: WhoReader,
	__sign: makeRegionEndpoint,
	__renderHtml: (props) => render_region_html(WhoReader, "/_app/immutable/og-region.7bc802f2e6f6.js", props)
});
var _7bc802f2e6f6_default = _bc802f2e6f6;
// src/lib/rtr/Reader.svelte
function Reader($$renderer) {
	$$renderer.push(`<h1 data-testid="reader">router reader page `);
	_7bc802f2e6f6_default($$renderer, {});
	$$renderer.push(`<!----></h1>`);
}

export { Deep as D, Home as H, Inner as I, PkgPage as P, Reader as R, Shell as S, StreamRegion as a, register_router_css as b, router_css_of as r };
//# sourceMappingURL=Reader.js-D_7hE2Ka.js.map
