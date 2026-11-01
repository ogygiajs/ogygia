import '../../../chunks/async.js-FhULVWAw.js';
import { _ as _416c9c898227_default } from '../../../chunks/416c9c898227.js-BJSsvlt3.js';
import { R as Region } from '../../../chunks/render-region-html.js-DsVhRg6l.js';
import { _ as _9e877c69694a_default, B as Badge } from '../../../chunks/9e877c69694a.js-Bvlvi45F.js';
import '../../../chunks/server.js-B9P4ExQ-.js';
import '../../../chunks/uneval.js-CHOeF-6t.js';
import '../../../chunks/shared.js-B7aDE0fO.js';
import '../../../chunks/internal.js-NlsCutcl.js';
import '../../../chunks/index-server2.js-uORi_mEb.js';
import '../../../chunks/rolldown-runtime.js-CTrrmpyn.js';
import '../../../chunks/paths.js-DHXamknv.js';
import '../../../chunks/routing.js-BCO6GjuO.js';
import '../../../chunks/internal2.js-Cq2bWI41.js';
import '../../../chunks/utils.js-BpLbUY9P.js';
import '../../../chunks/late-region-registry.js-DXI715J1.js';
import 'node:fs';
import 'node:path';
import 'node:url';
import 'node:crypto';
import '../../../chunks/live-transport.js-BhmTVvjO.js';
import '../../../chunks/state.js-DXGb76jd.js';
import '../../../chunks/exports.js-C-11U8cd.js';

// virtual:ogygia/wrapper/9e877c69694a.svelte
function _e877c69694a($$renderer, $$props) {
	let { ogygiaFallback, $$slots, $$events, ...__props } = $$props;
	Region($$renderer, {
		__mode: "server",
		__entry: "9e877c69694a",
		__component: _9e877c69694a_default,
		__css: Badge,
		__props,
		__defer: "load",
		ogygiaFallback
	});
}
// ../island-pkg/src/widgets/Panel.svelte
function Panel($$renderer) {
	$$renderer.push(`<section data-pkg-panel="" class="svelte-19mkrpb"><h2>Package panel (server HTML)</h2> `);
	_416c9c898227_default($$renderer, { start: 3 });
	$$renderer.push(`<!----> `);
	{
		function ogygiaFallback($$renderer) {
			$$renderer.push(`<span data-pkg-deferred-fallback="">badge loading…</span>`);
		}
		_e877c69694a($$renderer, {
			org: "acme",
			ogygiaFallback,
			$$slots: { ogygiaFallback: true }
		});
	}
	$$renderer.push(`<!----></section>`);
}
// src/routes/island-pkg/+page.svelte
function _page($$renderer) {
	$$renderer.push(`<h1 data-static-shell="">Declared-package island host</h1> `);
	Panel($$renderer);
	$$renderer.push(`<!---->`);
}

export { _page as default };
//# sourceMappingURL=_page.svelte.js-AeLsmX2z.js.map
