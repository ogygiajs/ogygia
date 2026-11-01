import '../../../chunks/async.js-CdyA1ipx.js';
import { R as Region } from '../../../chunks/Region.js-DspBOxVI.js';
import '../../../chunks/server.js-Cx6qdlSj.js';
import '../../../chunks/uneval.js-CHOeF-6t.js';
import '../../../chunks/index-server2.js-Dp0Lnfg2.js';
import '../../../chunks/rolldown-runtime.js-CTrrmpyn.js';
import '../../../chunks/late-region-registry.js-DFACBCYi.js';
import '../../../chunks/shared.js-B7aDE0fO.js';
import '../../../chunks/utils.js-DOLeCbnX.js';
import '../../../chunks/paths.js-DBACMOFs.js';
import '../../../chunks/internal.js-NlsCutcl.js';
import '../../../chunks/routing.js-BCO6GjuO.js';
import '../../../chunks/internal2.js-CT1i7Aye.js';
import '../../../chunks/legacy-client.js-DQU-0Hpk.js';
import 'node:fs';
import 'node:path';
import 'node:url';
import 'node:crypto';
import '../../../chunks/live-transport.js-DcfVhxYl.js';
import '../../../chunks/state.js-PRJNi6S7.js';
import '../../../chunks/exports.js-C-11U8cd.js';

// src/routes/content-css/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { data } = $$props;
		$$renderer.push(`<h1>content css</h1> `);
		if (data.body) {
			$$renderer.push("<!--[0-->");
			Region($$renderer, { of: data.body });
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]-->`);
	});
}

export { _page as default };
//# sourceMappingURL=_page.svelte.js-mzsfV88q.js.map
