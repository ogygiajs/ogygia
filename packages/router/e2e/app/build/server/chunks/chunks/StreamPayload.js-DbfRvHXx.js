import './async.js-FhULVWAw.js';
import { a1 as escape_html } from './server.js-B9P4ExQ-.js';
import { R as Region, m as makeRegionEndpoint, r as render_region_html } from './render-region-html.js-DsVhRg6l.js';

// src/lib/rtr/StreamTally.svelte
function StreamTally($$renderer) {
	$$renderer.push(`<button data-stream-island="">late island: ${escape_html(0)}</button>`);
}
// virtual:ogygia/island/e6d4c9f4ec7a.js
var e6d4c9f4ec7a_default$1 = StreamTally;
// virtual:ogygia/wrapper/e6d4c9f4ec7a.svelte
function E6d4c9f4ec7a($$renderer, $$props) {
	let { children, $$slots, $$events, ...__props } = $$props;
	Region($$renderer, {
		__mode: "island",
		load: true,
		__entry: "/_app/immutable/og-region.e6d4c9f4ec7a.js",
		__component: e6d4c9f4ec7a_default$1,
		__css: StreamTally,
		__props,
		children
	});
}
// virtual:ogygia/region/e6d4c9f4ec7a.js
Object.assign(E6d4c9f4ec7a, {
	__ogRegion: "e6d4c9f4ec7a",
	__module: "/_app/immutable/og-region.e6d4c9f4ec7a.js",
	__hydrate: "load",
	__component: StreamTally,
	__sign: makeRegionEndpoint,
	__renderHtml: (props) => render_region_html(StreamTally, "/_app/immutable/og-region.e6d4c9f4ec7a.js", props)
});
var e6d4c9f4ec7a_default = E6d4c9f4ec7a;
// src/lib/rtr/StreamPayload.svelte
function StreamPayload($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { data } = $$props;
		$$renderer.push(`<section data-stream-payload=""><h2>${escape_html(data.title)}</h2> `);
		e6d4c9f4ec7a_default($$renderer, {});
		$$renderer.push(`<!----></section>`);
	});
}

export { StreamPayload as S };
//# sourceMappingURL=StreamPayload.js-DbfRvHXx.js.map
