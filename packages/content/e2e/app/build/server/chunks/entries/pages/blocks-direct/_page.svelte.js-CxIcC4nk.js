import '../../../chunks/async.js-CdyA1ipx.js';
import { a3 as ensure_array_like, T as derived } from '../../../chunks/server.js-Cx6qdlSj.js';
import { R as Region } from '../../../chunks/Region.js-DspBOxVI.js';
import { b as blocks } from '../../../chunks/blocks.js-Cfocf_v9.js';
import '../../../chunks/src.js-CioERKRa.js';
import { _ as _53eeafeb0f8c_default, a as _7f826617dad4_default, b as _625ddf1e441c_default, c as _149d42e6c106_default } from '../../../chunks/53eeafeb0f8c.js-B1WfgCrT.js';
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
import '../../../chunks/payload.js-BFR-R8Ce.js';
import '../../../chunks/Hero.js-DYyJmJoQ.js';
import '../../../chunks/Grid.js-B1zm1sNf.js';
import '../../../chunks/Feature.js-Cd89R5GK.js';
import '../../../chunks/53eeafeb0f8c2.js-ku69fXC2.js';

// src/lib/MyBlocks.svelte
function MyBlocks($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { tree, registry, nodes } = $$props;
		const resolved = derived(() => nodes ?? blocks.resolve(tree, registry ?? {}));
		$$renderer.push(`<!--[-->`);
		const each_array = ensure_array_like(resolved());
		for (let i = 0, $$length = each_array.length; i < $$length; i++) {
			let node = each_array[i];
			Region($$renderer, {
				of: node.of,
				children: ($$renderer) => {
					if (node.children && node.children.length) {
						$$renderer.push("<!--[0-->");
						MyBlocks($$renderer, { nodes: node.children });
					} else $$renderer.push("<!--[-1-->");
					$$renderer.push(`<!--]-->`);
				}});
		}
		$$renderer.push(`<!--]-->`);
	});
}
// src/lib/blocks-direct-registry.ts
var registry = {
	Hero: _149d42e6c106_default,
	Grid: _625ddf1e441c_default,
	Feature: _7f826617dad4_default,
	CtaCounter: _53eeafeb0f8c_default
};
var tree = [
	{
		type: "Hero",
		props: {
			title: "Direct blocks",
			tagline: "no content collection"
		}
	},
	{
		type: "Grid",
		children: [{
			type: "Feature",
			props: {
				title: "A",
				body: "one"
			}
		}, {
			type: "Feature",
			props: {
				title: "B",
				body: "two"
			}
		}]
	},
	{
		type: "CtaCounter",
		props: { start: 5 }
	}
];
// src/routes/blocks-direct/+page.svelte
function _page($$renderer) {
	$$renderer.push(`<h1 data-static-shell="">Direct blocks (recipe, no collection)</h1> `);
	MyBlocks($$renderer, {
		tree,
		registry
	});
	$$renderer.push(`<!---->`);
}

export { _page as default };
//# sourceMappingURL=_page.svelte.js-CxIcC4nk.js.map
