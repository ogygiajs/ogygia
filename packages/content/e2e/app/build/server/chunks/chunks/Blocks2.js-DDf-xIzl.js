import './async.js-CdyA1ipx.js';
import { a3 as ensure_array_like, T as derived } from './server.js-Cx6qdlSj.js';
import { R as Region } from './Region.js-DspBOxVI.js';
import { r as resolve_block_tree } from './blocks.js-Cfocf_v9.js';
import './uneval.js-CHOeF-6t.js';
import './index-server2.js-Dp0Lnfg2.js';
import './rolldown-runtime.js-CTrrmpyn.js';
import './late-region-registry.js-DFACBCYi.js';
import './shared.js-B7aDE0fO.js';
import './utils.js-DOLeCbnX.js';
import './paths.js-DBACMOFs.js';
import './internal.js-NlsCutcl.js';
import './routing.js-BCO6GjuO.js';
import './internal2.js-CT1i7Aye.js';
import './legacy-client.js-DQU-0Hpk.js';
import 'node:fs';
import 'node:path';
import 'node:url';
import 'node:crypto';
import './live-transport.js-DcfVhxYl.js';
import './state.js-PRJNi6S7.js';
import './exports.js-C-11U8cd.js';

// ../../src/Blocks.svelte
function Blocks($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		/**
		* Render a Builder.io-style page tree — the one block renderer, public and internal both.
		*
		* Two ways in, same output:
		* - `<Blocks {tree} {registry} />` — you have a tree in hand (a prop, a literal, a one-off API
		*   response), no content collection. Resolves `type → region` against your registry per render.
		* - a `blocks()` collection body — already resolved at mint (registry consumed there), handed in as
		*   `nodes`. Nothing re-resolves; the registry never rode along.
		*
		* Either way every block becomes a region and renders through `<Region>` — a block tree is just a
		* shape of regions. Recursion passes the resolved `children` straight back in as `nodes`. An
		* unregistered `type` is skipped with a dev warning (in `resolve_block_tree`).
		*
		* Server-pass component: the registry's `with { region: 'raw' }` bindings resolve on the server
		* (where their signer lives), so `<Blocks>` renders in the SSR pass like every content body.
		*/
		let { tree, registry, schedule, nodes: resolved } = $$props;
		const nodes = derived(() => resolved ?? resolve_block_tree(tree, registry ?? {}, schedule));
		$$renderer.push(`<!--[-->`);
		const each_array = ensure_array_like(nodes());
		for (let i = 0, $$length = each_array.length; i < $$length; i++) {
			let node = each_array[i];
			Region($$renderer, {
				of: node.of,
				children: ($$renderer) => {
					if (node.children && node.children.length) {
						$$renderer.push("<!--[0-->");
						Blocks($$renderer, { nodes: node.children });
					} else $$renderer.push("<!--[-1-->");
					$$renderer.push(`<!--]-->`);
				}});
		}
		$$renderer.push(`<!--]-->`);
	});
}

export { Blocks as default };
//# sourceMappingURL=Blocks2.js-DDf-xIzl.js.map
