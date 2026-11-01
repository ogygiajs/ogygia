import '../../../../../chunks/async.js-BHxnfxQk.js';
import { a1 as escape_html } from '../../../../../chunks/server.js-BBF-BCcH.js';
import { a4 as Region } from '../../../../../chunks/Region.js-Vj2klmrC.js';
import { _ as _08f9c48354e4_default } from '../../../../../chunks/08f9c48354e42.js-DzCOIGk3.js';
import { B as BigHeader } from '../../../../../chunks/BigHeader.js-Rebmdz0V.js';
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
import '../../../../../chunks/session.remote.js--vda5JlW.js';

// virtual:ogygia/wrapper/08f9c48354e4.svelte
function _8f9c48354e4($$renderer, $$props) {
	let { ogygiaFallback, $$slots, $$events, ...__props } = $$props;
	Region($$renderer, {
		__mode: "server",
		__entry: "08f9c48354e4",
		__component: _08f9c48354e4_default,
		__css: BigHeader,
		__props,
		__defer: "load",
		__stitch: "serve",
		ogygiaFallback
	});
}
// src/routes/[lang]/[region]/stitched/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { data } = $$props;
		{
			function ogygiaFallback($$renderer) {
				$$renderer.push(`<p data-stitch-fallback="">loading…</p>`);
			}
			_8f9c48354e4($$renderer, {
				ogygiaFallback,
				$$slots: { ogygiaFallback: true }
			});
		}
		$$renderer.push(`<!----> <h1 data-postrender-page="">stitched</h1> <p>This SHELL is a stored page: render <span data-render="">${escape_html(data.render)}</span> never moves.</p> <p>The header above was rendered on the server FOR YOU and spliced into the stored bytes — check
	view-source: your name is in the first response.</p> <p><a href="/api/user?name=Puru">log in as Puru</a> · <a href="/api/user">log out</a></p>`);
	});
}

export { _page as default };
//# sourceMappingURL=_page.svelte.js-D3w5MAPW.js.map
