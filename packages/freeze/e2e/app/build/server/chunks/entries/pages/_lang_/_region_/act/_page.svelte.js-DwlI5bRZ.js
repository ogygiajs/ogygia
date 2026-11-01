import '../../../../../chunks/async.js-BHxnfxQk.js';
import { a1 as escape_html } from '../../../../../chunks/server.js-BBF-BCcH.js';
import '../../../../../chunks/uneval.js-CHOeF-6t.js';

// src/routes/[lang]/[region]/act/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { data } = $$props;
		$$renderer.push(`<h1 data-freeze-page="">act</h1> <p>render <span data-render="">${escape_html(data.render)}</span></p> <p>tally <span data-tally="">${escape_html(data.tally)}</span></p> <form method="POST"><button type="submit">bump</button></form>`);
	});
}

export { _page as default };
//# sourceMappingURL=_page.svelte.js-DwlI5bRZ.js.map
