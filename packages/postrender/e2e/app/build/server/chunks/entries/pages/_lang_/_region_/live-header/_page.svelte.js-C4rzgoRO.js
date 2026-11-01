import '../../../../../chunks/async.js-BHxnfxQk.js';
import { a1 as escape_html, Z as spread_props } from '../../../../../chunks/server.js-BBF-BCcH.js';
import { a4 as Region } from '../../../../../chunks/Region.js-Vj2klmrC.js';
import { B as BigHeader } from '../../../../../chunks/BigHeader.js-Rebmdz0V.js';
import { d as makeRegionEndpoint } from '../../../../../chunks/region-endpoint.js-B56gT2fK.js';
import { r as render_region_html } from '../../../../../chunks/render-region-html.js-CP7Ye2cw.js';
import '../../../../../chunks/uneval.js-CHOeF-6t.js';
import '../../../../../chunks/internal2.js-DKx3-kmQ.js';
import '../../../../../chunks/rolldown-runtime.js-CTrrmpyn.js';
import '../../../../../chunks/shared.js-iXTe6R8-.js';
import '../../../../../chunks/island-deps.js-B57ZxkfE.js';
import 'node:fs';
import 'node:path';
import 'node:url';
import '../../../../../chunks/exports.js-C-11U8cd.js';
import '../../../../../chunks/hash.js-C-SlWFdQ.js';
import '../../../../../chunks/internal.js-NlsCutcl.js';
import '../../../../../chunks/paths.js-C6xzMLZ4.js';
import '../../../../../chunks/routing.js-BCO6GjuO.js';
import '../../../../../chunks/utils.js-Ca9I6N5J.js';
import '../../../../../chunks/remote.js-CcSc56f7.js';
import '../../../../../chunks/state2.js-W8Je5oeU.js';
import 'node:crypto';
import '../../../../../chunks/session.remote.js--vda5JlW.js';

// virtual:ogygia/wrapper/bee37bffd7cf.svelte
function Bee37bffd7cf($$renderer, $$props) {
	let { $$slots, $$events, ...__props } = $$props;
	Region($$renderer, {
		__mode: "lake",
		__entry: "bee37bffd7cf",
		__remount: "swr",
		__when: "load",
		__props,
		children: ($$renderer) => {
			BigHeader($$renderer, spread_props([__props]));
		}});
}
// src/lib/HeaderHost.svelte
function HeaderHost($$renderer) {
	Bee37bffd7cf($$renderer, {});
}
// virtual:ogygia/island/66b250ec993f.js
var _66b250ec993f_default$1 = HeaderHost;
// virtual:ogygia/wrapper/66b250ec993f.svelte
function _6b250ec993f($$renderer, $$props) {
	let { children, $$slots, $$events, ...__props } = $$props;
	Region($$renderer, {
		__mode: "island",
		load: true,
		__entry: "/_app/immutable/og-region.66b250ec993f.js",
		__component: _66b250ec993f_default$1,
		__css: HeaderHost,
		__props,
		children
	});
}
// virtual:ogygia/region/66b250ec993f.js
Object.assign(_6b250ec993f, {
	__ogRegion: "66b250ec993f",
	__module: "/_app/immutable/og-region.66b250ec993f.js",
	__hydrate: "load",
	__component: HeaderHost,
	__sign: makeRegionEndpoint,
	__renderHtml: (props) => render_region_html(HeaderHost, "/_app/immutable/og-region.66b250ec993f.js", props)
});
var _66b250ec993f_default = _6b250ec993f;
// src/routes/[lang]/[region]/live-header/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { data } = $$props;
		_66b250ec993f_default($$renderer, {});
		$$renderer.push(`<!----> <h1 data-postrender-page="">live-header</h1> <p>This SHELL is a stored page: render <span data-render="">${escape_html(data.render)}</span> never moves.</p> <p>The header above arrived server-rendered IN the stored bytes (no fallback flash), then re-rendered
	itself on the server with YOUR cookies and swapped in.</p> <p><a href="/api/user?name=Puru">log in as Puru</a> · <a href="/api/user">log out</a></p>`);
	});
}

export { _page as default };
//# sourceMappingURL=_page.svelte.js-C4rzgoRO.js.map
