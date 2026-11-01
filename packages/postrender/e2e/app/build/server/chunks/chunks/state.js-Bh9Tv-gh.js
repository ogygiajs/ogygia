// src/lib/server/state.ts
var renders = /* @__PURE__ */ new Map();
/** Called from loads — counts an ACTUAL Kit render of `pathname` (stored-page hits never run it). */
function count_render(pathname) {
	const n = (renders.get(pathname) ?? 0) + 1;
	renders.set(pathname, n);
	return n;
}
function render_counts() {
	return Object.fromEntries(renders);
}
var cms = /* @__PURE__ */ new Map();
function cms_read(slug) {
	let doc = cms.get(slug);
	if (!doc) {
		doc = {
			version: 1,
			body: `content of ${slug} v1`
		};
		cms.set(slug, doc);
	}
	return doc;
}
/** The "publish": bump the doc version (the webhook then invalidates its URL). */
function cms_publish(slug) {
	const doc = cms_read(slug);
	const next = {
		version: doc.version + 1,
		body: `content of ${slug} v${doc.version + 1}`
	};
	cms.set(slug, next);
	return { version: next.version };
}

export { cms_read as a, cms_publish as b, count_render as c, render_counts as r };
//# sourceMappingURL=state.js-Bh9Tv-gh.js.map
