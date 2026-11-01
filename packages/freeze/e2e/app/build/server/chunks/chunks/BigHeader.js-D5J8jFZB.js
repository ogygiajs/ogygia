import './async.js-BHxnfxQk.js';
import { a1 as escape_html } from './server.js-BBF-BCcH.js';
import { w as whoami } from './session.remote.js-CZGDfeEf.js';

// src/lib/BigHeader.svelte
function BigHeader($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { ogygiaFallback } = $$props;
		var session;
		var $$promises = $$renderer.run([async () => session = await whoami()]);
		$$renderer.push(`<header data-big-header="" style="border: 2px solid #333; padding: 8px"><strong data-hello="">Hello, `);
		$$renderer.async([$$promises[0]], ($$renderer) => $$renderer.push(() => escape_html(session.user ?? "guest")));
		$$renderer.push(`</strong> <small data-rendered-at="">server-rendered at `);
		$$renderer.async([$$promises[0]], ($$renderer) => $$renderer.push(() => escape_html(session.at)));
		$$renderer.push(`</small></header>`);
	});
}

export { BigHeader as B };
//# sourceMappingURL=BigHeader.js-D5J8jFZB.js.map
