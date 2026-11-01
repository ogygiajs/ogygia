import '../../../../../../chunks/async.js-BHxnfxQk.js';
import { _ as attr, a1 as escape_html } from '../../../../../../chunks/server.js-BBF-BCcH.js';
import '../../../../../../chunks/uneval.js-CHOeF-6t.js';

// src/routes/[lang]/[region]/c/[slug]/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { data } = $$props;
		$$renderer.push(`<h1 data-postrender-page=""${attr("data-slug", data.slug)}>${escape_html(data.slug)}</h1> <p data-body="">${escape_html(data.body)}</p> <p>version <span data-version="">${escape_html(data.version)}</span></p> <p>promo <span data-promo="">${escape_html(data.promo.version)}</span></p> <p>render <span data-render="">${escape_html(data.render)}</span></p>`);
	});
}

export { _page as default };
//# sourceMappingURL=_page.svelte.js-rGhByPjZ.js.map
