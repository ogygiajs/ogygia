import { b as blocks } from '../../../chunks/blocks.js-Cfocf_v9.js';
import { c as content, m as makeRegionEndpoint, r as render_region_html } from '../../../chunks/src.js-CioERKRa.js';
import { _ as _53eeafeb0f8c_default, a as _7f826617dad4_default, b as _625ddf1e441c_default, c as _149d42e6c106_default } from '../../../chunks/53eeafeb0f8c.js-B1WfgCrT.js';
import { U as Unused } from '../../../chunks/Unused.js-BUmq-veZ.js';
import { v as error } from '../../../chunks/utils.js-DOLeCbnX.js';

// src/lib/blocks/pages.ts
/**
* Blocks collection with a SERVER-ONLY registry: this module is imported exclusively by
* `+page.server.ts`, so no page's client graph ever sees these components. That is the deliberate
* stress case — none of these components' CSS can be statically linked into any page stylesheet.
*
* Registry marks: static blocks are `region: 'raw'` (HTML only, zero JS); the counter bakes
* `wake: 'load'` (pages naming it pull exactly one hydrate chunk).
*/
var pages = content({ loader: blocks(/* #__PURE__ */ Object.assign({ "./pages/landing.json": () => import('../../../chunks/landing.js-CeLJbROE.js') }), {
	Hero: _149d42e6c106_default,
	Grid: _625ddf1e441c_default,
	Feature: _7f826617dad4_default,
	CtaCounter: _53eeafeb0f8c_default,
	Unused: {
		__ogRegion: "5e62f11b50f8",
		__module: "/_app/immutable/og-region.5e62f11b50f8.js",
		__component: Unused,
		__sign: makeRegionEndpoint,
		__renderHtml: (props) => render_region_html(Unused, "/_app/immutable/og-region.5e62f11b50f8.js", props)
	}
}) });
// src/routes/blocks/+page.ts
async function load() {
	const page = await pages.get("landing");
	if (!page) error(404, "no landing page");
	return { page };
}

var _page_ts = /*#__PURE__*/Object.freeze({
	__proto__: null,
	load: load
});

export { _page_ts as _ };
//# sourceMappingURL=_page.ts.js-DZVsnCwz.js.map
