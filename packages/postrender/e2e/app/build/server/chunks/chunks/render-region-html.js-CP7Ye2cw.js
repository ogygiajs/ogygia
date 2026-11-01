import { r as render } from './server.js-BBF-BCcH.js';
import { g as islandCss } from './island-deps.js-B57ZxkfE.js';
import { t as kit_page_ready, y as kit_render_context$1, ah as region_css_tags, z as kit_page_facts_tail } from './Region.js-Vj2klmrC.js';

// ../../../core/src/server/render-region-html.ts
/**
* A held region's server render to HTML (`__renderHtml` of a region binding): the component's body,
* prefixed with its island's stylesheet links and the region-CSS links its nested regions put in the
* head — the page never imported a server-picked component, so its CSS is on no page stylesheet.
* ONE copy for every island (the compiler used to inline this into each binding: hundreds of copies
* of the same code in the server bundle, parsed at every cold start).
*
* A fresh render root: it sees the page of the render (server/render-page.ts) like every other root
* ogygia starts — awaited first, so a region a remote call renders reads its page's `page.data`.
*/
/** context.ts's LAKE key (`isInLake`), by its global name — context.ts reaches virtual modules. */
var LAKE_SUBTREE_KEY = Symbol.for("ogygia.lake-subtree");
async function render_region_html(component, module_url, props) {
	await kit_page_ready();
	const context = kit_render_context$1();
	context.set(LAKE_SUBTREE_KEY, true);
	const r = await render(component, {
		props,
		context
	});
	let own = "";
	for (const href of islandCss(module_url)) own += "<link rel=\"stylesheet\" href=\"" + href + "\" data-ogygia-region-css>";
	return own + region_css_tags(r.head) + r.body + kit_page_facts_tail();
}

export { render_region_html as r };
//# sourceMappingURL=render-region-html.js-CP7Ye2cw.js.map
