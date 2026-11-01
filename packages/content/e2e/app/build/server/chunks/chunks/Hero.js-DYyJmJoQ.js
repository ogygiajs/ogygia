import './async.js-CdyA1ipx.js';
import { a1 as escape_html } from './server.js-Cx6qdlSj.js';

// src/lib/blocks/Hero.svelte
function Hero($$renderer, $$props) {
	let { title, tagline } = $$props;
	$$renderer.push(`<header class="blk-hero svelte-n9h4ry"><h2 class="svelte-n9h4ry">${escape_html(title)}</h2> `);
	if (tagline) {
		$$renderer.push("<!--[0-->");
		$$renderer.push(`<p class="svelte-n9h4ry">${escape_html(tagline)}</p>`);
	} else $$renderer.push("<!--[-1-->");
	$$renderer.push(`<!--]--></header>`);
}

export { Hero as H };
//# sourceMappingURL=Hero.js-DYyJmJoQ.js.map
