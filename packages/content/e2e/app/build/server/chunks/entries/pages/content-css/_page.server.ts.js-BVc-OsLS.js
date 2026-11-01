import { _ as __exportAll } from '../../../chunks/rolldown-runtime.js-CTrrmpyn.js';
import '../../../chunks/async.js-CdyA1ipx.js';
import { c as content } from '../../../chunks/src.js-CioERKRa.js';
import { p as prebaked_region, r as region } from '../../../chunks/Region.js-DspBOxVI.js';
import { d as defineSource, t as toRawSource } from '../../../chunks/blocks.js-Cfocf_v9.js';

// ../../src/formats.ts
function as_object(value, label) {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`[ogygia/content] ${label}: expected a plain object (got ${Array.isArray(value) ? "array" : typeof value})`);
	return value;
}
var markdown_format = (resolved, id) => {
	if (!resolved || typeof resolved !== "object" || Array.isArray(resolved)) throw new Error(`[ogygia/content] markdown: ${id}: expected a module with metadata`);
	const mod = resolved;
	if (!("metadata" in mod)) throw new Error(`[ogygia/content] markdown: ${id}: missing metadata (is markdown configured?)`);
	const { headings, links, ...data } = as_object(mod.metadata ?? {}, `markdown:${id}`);
	const source = typeof mod.__ogygia_source === "function" ? mod.__ogygia_source : void 0;
	const baked = mod.__ogygia_region?.html;
	const css_id = typeof mod.__ogygia_css === "string" ? mod.__ogygia_css : void 0;
	return {
		data,
		...mod.default !== void 0 ? { body: typeof baked === "string" ? prebaked_region(mod.default, baked, css_id) : region(mod.default, {}, void 0, css_id) } : {},
		...source ? { source } : {},
		meta: {
			headings: Array.isArray(headings) ? headings : [],
			links: Array.isArray(links) ? links : []
		}
	};
};
/** `.svx` / `.md` content compiled by the markdown pipeline — body is the component, meta has headings. */
function markdown(input, opts = {}) {
	return defineSource(toRawSource(input, opts), markdown_format);
}
// src/content/content-css/probe/+doc.svx
var _doc_exports = /* @__PURE__ */ __exportAll({
	__ogygia_css: () => __ogygia_css,
	__ogygia_source: () => __ogygia_source,
	default: () => _doc_svx,
	metadata: () => metadata
});
var __ogygia_source = () => import('../../../chunks/_doc.js-BaMEzc_S.js').then((m) => m.default);
var __ogygia_css = "content/content-css/probe/+doc.svx";
var metadata = {
	"title": "content css probe",
	"headings": [],
	"links": []
};
function _doc_svx($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		$$renderer.push(`<div class="cssprobe svelte-1amorxr" data-content-css-probe="">content body css probe</div>`);
	});
}
// src/routes/content-css/+page.server.ts
var docs = content({ loader: markdown(/* #__PURE__ */ Object.assign({ "../../content/content-css/probe/+doc.svx": _doc_exports })) });
var load = async () => {
	const [ref] = await docs.refs();
	return { body: (ref ? await docs.get(ref.id) : null)?.body };
};

var _page_server_ts = /*#__PURE__*/Object.freeze({
	__proto__: null,
	load: load
});

export { _page_server_ts as _ };
//# sourceMappingURL=_page.server.ts.js-BVc-OsLS.js.map
