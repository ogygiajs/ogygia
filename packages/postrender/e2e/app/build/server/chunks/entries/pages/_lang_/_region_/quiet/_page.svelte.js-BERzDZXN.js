import '../../../../../chunks/async.js-BHxnfxQk.js';
import { a1 as escape_html } from '../../../../../chunks/server.js-BBF-BCcH.js';
import '../../../../../chunks/uneval.js-CHOeF-6t.js';

// src/routes/[lang]/[region]/quiet/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { data } = $$props;
		$$renderer.push(`<h1 data-testid="quiet">quiet (inherits config.postrender = false), render ${escape_html(data.render)}</h1>`);
	});
}

export { _page as default };
//# sourceMappingURL=_page.svelte.js-BERzDZXN.js.map
