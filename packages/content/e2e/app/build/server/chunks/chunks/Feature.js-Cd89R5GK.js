import './async.js-CdyA1ipx.js';
import { a1 as escape_html } from './server.js-Cx6qdlSj.js';

// src/lib/blocks/Feature.svelte
function Feature($$renderer, $$props) {
	let { title, body } = $$props;
	$$renderer.push(`<div class="blk-feature svelte-qy0uj0"><h3 class="svelte-qy0uj0">${escape_html(title)}</h3> `);
	if (body) {
		$$renderer.push("<!--[0-->");
		$$renderer.push(`<p class="svelte-qy0uj0">${escape_html(body)}</p>`);
	} else $$renderer.push("<!--[-1-->");
	$$renderer.push(`<!--]--></div>`);
}

export { Feature as F };
//# sourceMappingURL=Feature.js-Cd89R5GK.js.map
