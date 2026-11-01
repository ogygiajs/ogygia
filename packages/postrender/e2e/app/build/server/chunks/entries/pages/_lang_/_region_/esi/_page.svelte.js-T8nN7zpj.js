import '../../../../../chunks/async.js-BHxnfxQk.js';
import { a1 as escape_html } from '../../../../../chunks/server.js-BBF-BCcH.js';
import { a4 as Region } from '../../../../../chunks/Region.js-Vj2klmrC.js';
import { _ as _2b59bdc83cb8_default } from '../../../../../chunks/2b59bdc83cb82.js-DeOSwE90.js';
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

// virtual:ogygia/wrapper/2b59bdc83cb8.svelte
function _b59bdc83cb8($$renderer, $$props) {
	let { ogygiaFallback, $$slots, $$events, ...__props } = $$props;
	Region($$renderer, {
		__mode: "server",
		__entry: "2b59bdc83cb8",
		__component: _2b59bdc83cb8_default,
		__css: BigHeader,
		__props,
		__defer: "load",
		__stitch: "edge",
		ogygiaFallback
	});
}
// src/routes/[lang]/[region]/esi/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { data } = $$props;
		{
			function ogygiaFallback($$renderer) {
				$$renderer.push(`<p data-stitch-fallback="">loading…</p>`);
			}
			_b59bdc83cb8($$renderer, {
				ogygiaFallback,
				$$slots: { ogygiaFallback: true }
			});
		}
		$$renderer.push(`<!----> <h1 data-postrender-page="">esi</h1> <p>This SHELL is a stored page: render <span data-render="">${escape_html(data.render)}</span> never moves.</p> <p>The header above is an EDGE-stitched hole: the stored bytes carry an ESI include the CDN fills per
	request from the hole's signed capability, so the shell stays cached at the edge and origin
	renders only the header.</p> <p><a href="/api/user?name=Puru">log in as Puru</a> · <a href="/api/user">log out</a></p>`);
	});
}

export { _page as default };
//# sourceMappingURL=_page.svelte.js-T8nN7zpj.js.map
