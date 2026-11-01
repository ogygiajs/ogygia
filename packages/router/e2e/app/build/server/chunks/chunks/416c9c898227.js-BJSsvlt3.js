import './async.js-FhULVWAw.js';
import { a1 as escape_html } from './server.js-B9P4ExQ-.js';
import { R as Region, m as makeRegionEndpoint, r as render_region_html } from './render-region-html.js-DsVhRg6l.js';

// ../island-pkg/src/widgets/Tally.svelte
function Tally($$renderer, $$props) {
	let { start = 0 } = $$props;
	let n = start;
	$$renderer.push(`<button data-pkg-island="">pkg tally: ${escape_html(n)}</button>`);
}
// virtual:ogygia/island/416c9c898227.js
var _416c9c898227_default$1 = Tally;
// virtual:ogygia/wrapper/416c9c898227.svelte
function _16c9c898227($$renderer, $$props) {
	let { children, $$slots, $$events, ...__props } = $$props;
	Region($$renderer, {
		__mode: "island",
		load: true,
		__entry: "/_app/immutable/og-region.416c9c898227.js",
		__component: _416c9c898227_default$1,
		__css: Tally,
		__props,
		children
	});
}
// virtual:ogygia/region/416c9c898227.js
Object.assign(_16c9c898227, {
	__ogRegion: "416c9c898227",
	__module: "/_app/immutable/og-region.416c9c898227.js",
	__hydrate: "load",
	__component: Tally,
	__sign: makeRegionEndpoint,
	__renderHtml: (props) => render_region_html(Tally, "/_app/immutable/og-region.416c9c898227.js", props)
});
var _416c9c898227_default = _16c9c898227;

export { _416c9c898227_default as _ };
//# sourceMappingURL=416c9c898227.js-BJSsvlt3.js.map
