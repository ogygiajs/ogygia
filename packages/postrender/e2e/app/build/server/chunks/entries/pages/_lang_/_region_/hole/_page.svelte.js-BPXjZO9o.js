import '../../../../../chunks/async.js-BHxnfxQk.js';
import { a1 as escape_html } from '../../../../../chunks/server.js-BBF-BCcH.js';
import { a4 as Region } from '../../../../../chunks/Region.js-Vj2klmrC.js';
import { _ as _9d043e785fd3_default, H as Hole } from '../../../../../chunks/9d043e785fd3.js-P9cShcgD.js';
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

// virtual:ogygia/wrapper/9d043e785fd3.svelte
function _d043e785fd3($$renderer, $$props) {
	let { ogygiaFallback, $$slots, $$events, ...__props } = $$props;
	Region($$renderer, {
		__mode: "server",
		__entry: "9d043e785fd3",
		__component: _9d043e785fd3_default,
		__css: Hole,
		__props,
		__defer: "load",
		ogygiaFallback
	});
}
// src/routes/[lang]/[region]/hole/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { data } = $$props;
		$$renderer.push(`<h1 data-postrender-page="">hole</h1> <p>render <span data-render="">${escape_html(data.render)}</span></p> `);
		{
			function ogygiaFallback($$renderer) {
				$$renderer.push(`<p data-hole-fallback="">loading…</p>`);
			}
			_d043e785fd3($$renderer, {
				ogygiaFallback,
				$$slots: { ogygiaFallback: true }
			});
		}
		$$renderer.push(`<!---->`);
	});
}

export { _page as default };
//# sourceMappingURL=_page.svelte.js-BPXjZO9o.js.map
