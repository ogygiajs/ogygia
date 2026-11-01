import '../../../../../chunks/async.js-BHxnfxQk.js';
import { a1 as escape_html, a2 as await_block } from '../../../../../chunks/server.js-BBF-BCcH.js';
import { a0 as Region } from '../../../../../chunks/Region.js-SNqDpRL3.js';
import { m as makeRegionEndpoint, r as render_region_html } from '../../../../../chunks/render-region-html.js-xDenbgGJ.js';
import '../../../../../chunks/uneval.js-CHOeF-6t.js';
import '../../../../../chunks/internal2.js-2Pg1NhOR.js';
import '../../../../../chunks/rolldown-runtime.js-CTrrmpyn.js';
import '../../../../../chunks/shared.js-iXTe6R8-.js';
import '../../../../../chunks/island-deps.js-DRCEB_nS.js';
import 'node:fs';
import 'node:path';
import 'node:url';
import '../../../../../chunks/exports.js-C-11U8cd.js';
import '../../../../../chunks/hash.js-C-SlWFdQ.js';
import '../../../../../chunks/internal.js-NlsCutcl.js';
import '../../../../../chunks/paths.js-DM9UWvpx.js';
import '../../../../../chunks/routing.js-BCO6GjuO.js';
import '../../../../../chunks/utils.js-Ca9I6N5J.js';
import '../../../../../chunks/remote.js-CcSc56f7.js';
import '../../../../../chunks/state2.js-CxjaPru1.js';
import 'node:crypto';
import '../../../../../chunks/payload.js-DW7rNLSc.js';

// src/lib/Tick.svelte
function Tick($$renderer) {
	$$renderer.push(`<button data-tick="">tick ${escape_html(0)}</button>`);
}
// virtual:ogygia/island/95906992795f.js
var _95906992795f_default$1 = Tick;
// virtual:ogygia/wrapper/95906992795f.svelte
function _5906992795f($$renderer, $$props) {
	let { children, $$slots, $$events, ...__props } = $$props;
	Region($$renderer, {
		__mode: "island",
		load: true,
		__entry: "/_app/immutable/og-region.95906992795f.js",
		__component: _95906992795f_default$1,
		__css: Tick,
		__props,
		children
	});
}
// virtual:ogygia/region/95906992795f.js
Object.assign(_5906992795f, {
	__ogRegion: "95906992795f",
	__module: "/_app/immutable/og-region.95906992795f.js",
	__hydrate: "load",
	__component: Tick,
	__sign: makeRegionEndpoint,
	__renderHtml: (props) => render_region_html(Tick, "/_app/immutable/og-region.95906992795f.js", props)
});
var _95906992795f_default = _5906992795f;
// src/routes/[lang]/[region]/stream/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { data } = $$props;
		$$renderer.push(`<h1 data-freeze-page="">stream</h1> <p>render <span data-render="">${escape_html(data.render)}</span></p> `);
		await_block($$renderer, data.slow, () => {
			$$renderer.push(`<p data-slow="">waiting…</p>`);
		}, (value) => {
			$$renderer.push(`<p data-slow="">${escape_html(value)}</p>`);
		});
		$$renderer.push(`<!--]--> `);
		_95906992795f_default($$renderer, {});
		$$renderer.push(`<!---->`);
	});
}

export { _page as default };
//# sourceMappingURL=_page.svelte.js-COx7-at8.js.map
