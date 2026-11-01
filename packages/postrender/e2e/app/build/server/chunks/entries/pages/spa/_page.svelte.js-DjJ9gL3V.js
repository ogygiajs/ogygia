import '../../../chunks/async.js-BHxnfxQk.js';
import { a1 as escape_html } from '../../../chunks/server.js-BBF-BCcH.js';
import '../../../chunks/uneval.js-CHOeF-6t.js';

// src/routes/spa/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { data } = $$props;
		$$renderer.push(`<h1 data-postrender-page="" data-spa="">spa (csr=true)</h1> <p>render <span data-render="">${escape_html(data.render)}</span></p>`);
	});
}

export { _page as default };
//# sourceMappingURL=_page.svelte.js-DjJ9gL3V.js.map
